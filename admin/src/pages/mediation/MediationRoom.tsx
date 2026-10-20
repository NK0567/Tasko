import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Send, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { disputesApi, uploadsApi } from '../../api/admin';
import type { Dispute, ListResponse, MediationMessage, PartyRole, Proposal } from '../../api/types';
import { useToast } from '../../components/feedback-context';
import { Badge, ErrorState, Loading, Spinner } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { PROPOSAL_STATUS } from '../../lib/labels';
import { getSocket } from '../../lib/socket';

const ROLE_NAME: Record<PartyRole, string> = { client: 'Client', provider: 'Prestataire', admin: 'Médiateur Tasko' };

function roleOf(d: Dispute, m: MediationMessage): PartyRole | 'system' {
  if (m.type === 'system' || m.sender_role === 'system') return 'system';
  if (m.sender_role) return m.sender_role;
  if (m.sender_id === d.job.client.id) return 'client';
  if (d.job.provider && m.sender_id === d.job.provider.id) return 'provider';
  return 'admin';
}

function Acceptance({ who, v }: { who: string; v: boolean | null }) {
  return (
    <span className={`badge ${v === true ? 'tone-green' : v === false ? 'tone-red' : 'tone-orange'}`}>
      {who} : {v === true ? 'accepte' : v === false ? 'refuse' : 'en attente'}
    </span>
  );
}

export function ProposalCard({ p }: { p: Proposal }) {
  const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, tone: 'gray' as const };
  return (
    <div className="proposal">
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 6 }}>
        <span className="strong">Proposition d'accord · {p.author.role === 'admin' ? 'Médiateur Tasko' : p.author.full_name}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <dl className="dl" style={{ margin: '8px 0' }}>
        <dt>Au prestataire</dt>
        <dd className="num">{formatMoney(p.provider_amount)}</dd>
        <dt>Remboursé au client</dt>
        <dd className="num">{formatMoney(p.client_refund)}</dd>
      </dl>
      {p.message && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.message}</div>}
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <Acceptance who="Client" v={p.client_accepted} />
        <Acceptance who="Prestataire" v={p.provider_accepted} />
      </div>
    </div>
  );
}

/**
 * Salon de médiation à trois (RG-G12) : historique via GET /disputes/:id/messages,
 * temps réel via Socket.IO (room conversation:<id>, événements message:new et dispute:updated).
 * Les messages font foi : ni modification ni suppression.
 */
export default function MediationRoom({ dispute, readOnly }: { dispute: Dispute; readOnly?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['disputes', 'messages', dispute.id];
  const messages = useQuery({ queryKey: key, queryFn: () => disputesApi.messages(dispute.id), retry: false });
  const [text, setText] = useState('');
  const [live, setLive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const append = (m: MediationMessage) =>
    qc.setQueryData<ListResponse<MediationMessage>>(key, (old) => {
      const items = old?.items ?? [];
      return items.some((x) => x.id === m.id) ? old : { items: [...items, m] };
    });

  // Temps réel
  useEffect(() => {
    const s = getSocket();
    const convId = dispute.conversation_id;
    if (!s || !convId) return;
    const join = () => {
      s.emit('conversation:join', { conversation_id: convId });
      setLive(true);
    };
    const onDisconnect = () => setLive(false);
    const onMessage = (m: MediationMessage) => {
      if (m.conversation_id === convId) append(m);
    };
    const onDispute = (d: { id?: string }) => {
      if (d?.id === dispute.id) void qc.invalidateQueries({ queryKey: ['disputes'] });
    };
    if (s.connected) join();
    s.on('connect', join);
    s.on('disconnect', onDisconnect);
    s.on('message:new', onMessage);
    s.on('dispute:updated', onDispute);
    return () => {
      s.off('connect', join);
      s.off('disconnect', onDisconnect);
      s.off('message:new', onMessage);
      s.off('dispute:updated', onDispute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append/qc stables pour ce litige
  }, [dispute.id, dispute.conversation_id]);

  const count = messages.data?.items.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = useMutation({
    mutationFn: (input: { type: 'text' | 'image'; body: string }) => disputesApi.sendMessage(dispute.id, input),
    onSuccess: (m) => {
      append(m);
      setText('');
    },
    onError: (e) => toast.error(e),
  });
  const uploadPhoto = useMutation({
    mutationFn: (file: File) => uploadsApi.image(file),
    onSuccess: ({ url }) => send.mutate({ type: 'image', body: url }),
    onError: (e) => toast.error(e),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (body) send.mutate({ type: 'text', body });
  }

  const proposals = new Map((dispute.proposals ?? []).map((p) => [p.id, p]));
  const busy = send.isPending || uploadPhoto.isPending;

  return (
    <div className="room">
      <div className="room-head">
        <strong>Salon de médiation</strong>
        <span className="small muted">Client · Prestataire · Médiateur Tasko — messages horodatés, non modifiables</span>
        <span className={`badge ${live ? 'tone-green' : 'tone-gray'}`} title={live ? 'Mise à jour en temps réel' : 'Temps réel indisponible : actualisation manuelle'}>
          {live ? <Wifi size={12} aria-hidden /> : <WifiOff size={12} aria-hidden />} {live ? 'En direct' : 'Hors ligne'}
        </span>
      </div>
      <div className="room-list" ref={listRef} aria-live="polite" aria-label="Messages du salon">
        {messages.isLoading ? (
          <Loading label="Chargement des messages…" />
        ) : messages.isError ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : count === 0 ? (
          <p className="muted small" style={{ textAlign: 'center', margin: '24px 0' }}>
            Aucun message pour l'instant. Présentez-vous aux deux parties et demandez leurs preuves.
          </p>
        ) : (
          messages.data!.items.map((m) => {
            const role = roleOf(dispute, m);
            if (role === 'system' && m.type !== 'proposal') {
              return (
                <div key={m.id} className="msg-system">
                  {m.body} <span className="num">· {formatDateTime(m.created_at)}</span>
                </div>
              );
            }
            if (m.type === 'proposal') {
              const p = proposals.get(m.body);
              return (
                <div key={m.id} className="msg-proposal">
                  {p ? <ProposalCard p={p} /> : <div className="small muted">Proposition d'accord publiée</div>}
                  <div className="small muted num">{formatDateTime(m.created_at)}</div>
                </div>
              );
            }
            const name =
              role === 'admin'
                ? 'Médiateur Tasko'
                : `${role === 'client' ? dispute.job.client.full_name : dispute.job.provider?.full_name ?? 'Prestataire'} · ${role === 'system' ? 'Système' : ROLE_NAME[role]}`;
            return (
              <div key={m.id} className={`msg msg-${role}`}>
                <div className="msg-author">
                  {role === 'admin' && <ShieldCheck size={12} aria-hidden />} {name}
                </div>
                {m.type === 'image' ? (
                  <a href={m.body} target="_blank" rel="noopener noreferrer" aria-label="Photo (ouvrir en grand)">
                    <img src={m.body} alt="Photo envoyée dans le salon" className="msg-img" loading="lazy" />
                  </a>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                )}
                <div className="msg-time num">{formatDateTime(m.created_at)}</div>
              </div>
            );
          })
        )}
      </div>
      {readOnly ? (
        <div className="room-foot small muted">Litige clos : le salon est en lecture seule.</div>
      ) : (
        <form className="room-foot" onSubmit={submit}>
          <label htmlFor="room-input" className="sr-only">
            Message aux deux parties
          </label>
          <textarea
            id="room-input"
            className="input"
            rows={2}
            placeholder="Écrire aux deux parties (signé « Médiateur Tasko »)…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
            }}
            style={{ minHeight: 44 }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) uploadPhoto.mutate(f);
            }}
          />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Envoyer une photo" title="Envoyer une photo">
            {uploadPhoto.isPending ? <Spinner small /> : <ImagePlus size={18} />}
          </button>
          <button type="submit" className="btn" disabled={busy || !text.trim()} aria-label="Envoyer le message">
            {send.isPending ? <Spinner small /> : <Send size={16} />}
            <span className="hide-sm">Envoyer</span>
          </button>
        </form>
      )}
    </div>
  );
}

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Star, Trash2 } from 'lucide-react';
import { reviewsApi } from '../../api/admin';
import { useConfirm, useToast } from '../../components/feedback-context';
import { Avatar, Empty, Pagination, QueryState } from '../../components/ui';
import { timeAgo } from '../../lib/format';

function Stars({ n }: { n: number }) {
  return (
    <span className="row" style={{ gap: 1 }} aria-label={`${n} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} fill={i <= n ? '#F5B700' : 'none'} color={i <= n ? '#F5B700' : '#CFD8D3'} />
      ))}
    </span>
  );
}

export default function Reviews() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const LIMIT = 20;
  const query = useQuery({
    queryKey: ['reviews', page],
    queryFn: () => reviewsApi.list({ page, limit: LIMIT }),
    placeholderData: keepPreviousData,
  });
  const del = useMutation({
    mutationFn: (id: string) => reviewsApi.remove(id),
    onSuccess: () => {
      toast.success('Avis supprimé.');
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="card">
      <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<Empty title="Aucun avis" icon={<MessageSquare size={24} />}><span>Les avis laissés par les clients apparaîtront ici. Supprimez uniquement les avis injurieux ou frauduleux.</span></Empty>}>
        {(d) => (
          <>
            {d.items.map((r) => (
              <div key={r.id} className="row" style={{ padding: 16, borderBottom: '1px solid var(--gray-100)', alignItems: 'flex-start' }}>
                <Avatar name={r.author.full_name} url={r.author.avatar_url} />
                <div className="grow">
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className="strong">{r.author.full_name}</span>
                    <Stars n={r.rating} />
                    <span className="muted small">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.target_name && <div className="small muted">sur {r.target_name}</div>}
                  <div style={{ marginTop: 4, color: r.comment ? 'var(--gray-900)' : 'var(--gray-500)' }}>{r.comment || 'Sans commentaire'}</div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  title="Supprimer cet avis"
                  aria-label="Supprimer cet avis"
                  disabled={del.isPending && del.variables === r.id}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Supprimer cet avis ?',
                      message: `L'avis de ${r.author.full_name} (${r.rating}/5) sera retiré définitivement et la note du prestataire recalculée.`,
                      confirmLabel: 'Supprimer',
                      danger: true,
                    });
                    if (ok) del.mutate(r.id);
                  }}
                >
                  <Trash2 size={16} color="var(--red)" />
                </button>
              </div>
            ))}
            <Pagination page={d.page || page} limit={d.limit || LIMIT} total={d.total} onPage={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}


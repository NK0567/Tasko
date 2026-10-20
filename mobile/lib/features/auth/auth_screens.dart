import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/formatters.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/cameroon_flag.dart';
import '../../widgets/common.dart';
import '../../widgets/tasko_button.dart';
import '../../widgets/tasko_logo.dart';

/// Champ téléphone avec préfixe +237.
class PhoneField extends StatelessWidget {
  const PhoneField({super.key, required this.controller, this.label = 'Téléphone'});
  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.phone,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(9),
      ],
      decoration: InputDecoration(
        labelText: label,
        hintText: '6XX XX XX XX',
        prefixIcon: const Padding(
          padding: EdgeInsets.only(left: 14, right: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CameroonFlag(width: 24),
              SizedBox(width: 6),
              Text('+237', style: TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
      validator: (v) => normalizeCameroonPhone(v ?? '') == null
          ? 'Numéro invalide (9 chiffres, commence par 6 ou 2)'
          : null,
    );
  }
}

class _AuthScaffold extends StatelessWidget {
  const _AuthScaffold({required this.title, required this.subtitle, required this.child});
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Retour',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              children: [
                const Align(alignment: Alignment.centerLeft, child: TaskoLogo(size: 36)),
                const SizedBox(height: 24),
                Text(
                  title,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: TaskoColors.primaryDark,
                      ),
                ),
                const SizedBox(height: 6),
                Text(subtitle, style: const TextStyle(color: TaskoColors.textMuted)),
                const SizedBox(height: 24),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Connexion : téléphone + mot de passe.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ref
          .read(authProvider.notifier)
          .login(normalizeCameroonPhone(_phone.text)!, _password.text);
      if (mounted) context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Bon retour !',
      subtitle: 'Connectez-vous pour retrouver vos missions et vos messages.',
      child: Form(
        key: _form,
        child: Column(
          children: [
            PhoneField(controller: _phone),
            const SizedBox(height: 14),
            TextFormField(
              controller: _password,
              obscureText: _obscure,
              onFieldSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Mot de passe',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  tooltip: _obscure ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                  icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
              validator: (v) => (v ?? '').length < 6 ? '6 caractères minimum' : null,
            ),
            const SizedBox(height: 24),
            TaskoButton(label: 'Se connecter', loading: _loading, onPressed: _submit),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => context.go('/register'),
              child: const Text('Pas encore de compte ? Créer un compte'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Inscription : nom, téléphone, mot de passe, code OTP (prérempli en dev).
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;
  bool _obscure = true;
  String? _devCode;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _password.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final code = await ref.read(apiProvider).requestOtp(normalizeCameroonPhone(_phone.text)!);
      setState(() {
        _otpSent = true;
        _devCode = code;
        if (code != null) _otp.text = code;
      });
      if (mounted) {
        showSnack(
          context,
          code != null
              ? 'Mode développement : code $code prérempli.'
              : 'Code envoyé par SMS au +237 ${_phone.text}.',
        );
      }
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _register() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ref.read(authProvider.notifier).register(
            fullName: _name.text.trim(),
            phone: normalizeCameroonPhone(_phone.text)!,
            password: _password.text,
            otpCode: _otp.text.trim(),
            city: ref.read(selectedCityProvider)?.name ?? 'Yaoundé',
          );
      if (mounted) context.go('/home');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Créer mon compte',
      subtitle: 'Un seul compte pour demander des services… ou en proposer !',
      child: Form(
        key: _form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Nom complet',
                prefixIcon: Icon(Icons.person_outline),
              ),
              validator: (v) => (v ?? '').trim().length < 2 ? 'Indiquez votre nom' : null,
            ),
            const SizedBox(height: 14),
            PhoneField(controller: _phone),
            const SizedBox(height: 14),
            TextFormField(
              controller: _password,
              obscureText: _obscure,
              decoration: InputDecoration(
                labelText: 'Mot de passe',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  tooltip: _obscure ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                  icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
              validator: (v) => (v ?? '').length < 6 ? '6 caractères minimum' : null,
            ),
            if (_otpSent) ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _otp,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(6),
                ],
                style: const TextStyle(letterSpacing: 6, fontWeight: FontWeight.w600),
                decoration: InputDecoration(
                  labelText: 'Code de vérification (OTP)',
                  prefixIcon: const Icon(Icons.sms_outlined),
                  helperText: _devCode != null ? 'Code de développement prérempli' : null,
                ),
                validator: (v) => (v ?? '').length < 4 ? 'Saisissez le code reçu' : null,
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _loading ? null : _requestOtp,
                  child: const Text('Renvoyer le code'),
                ),
              ),
            ],
            const SizedBox(height: 20),
            TaskoButton(
              label: _otpSent ? 'Créer mon compte' : 'Recevoir le code',
              loading: _loading,
              onPressed: _otpSent ? _register : _requestOtp,
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => context.go('/login'),
              child: const Text('Déjà un compte ? Se connecter'),
            ),
            const SizedBox(height: 8),
            const Text(
              'En continuant, vous acceptez les conditions d’utilisation de Tasko.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: TaskoColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}

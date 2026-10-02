import { authClient, authFail, cleanName, sessionPayload, translate } from '@/lib/auth-api';
import { createAdminClient } from '@/lib/supabase/admin';
import { body, corsPreflight, json, text } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/auth/signup   { email, password, name }
 *
 * Crear cuenta desde el juego.
 *
 * Se crea con la clave de SERVICIO y con el correo ya dado por bueno, en lugar
 * de con el registro normal. El motivo es la sala de espera que montaría lo
 * contrario: el registro normal manda un correo de confirmación y no devuelve
 * sesión hasta que alguien lo pulsa, así que el jugador se quedaría mirando una
 * pantalla dentro del juego esperando a un correo. Y en el plan gratuito de
 * Supabase el envío está limitado a un puñado de correos por hora: a la cuarta
 * persona que se registre, ese correo no llega.
 *
 * Lo que se pierde es la comprobación de que el correo existe. Aquí eso no
 * protege gran cosa -no hay dinero, ni compras, ni datos de nadie- y a cambio
 * se gana que crear la cuenta sea una pantalla y no dos y una espera.
 *
 * El nombre se reserva en el MISMO paso que la cuenta: el índice único de
 * profiles es lo que de verdad impide dos nombres iguales, y si salta, la
 * cuenta recién creada se borra en lugar de quedarse a medias.
 */
export const dynamic = 'force-dynamic';

const MIN_NAME = 3;
const MIN_PASSWORD = 8;

export async function POST(request: Request) {
  // Versiones que ya no pueden jugar online (o mantenimiento): ni entrar ni
  // renovar la sesión. Así el juego viejo se entera al conectar, no a medias.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const input = await body<{ email?: string; password?: string; name?: string }>(request);

  const email = text(input.email, 160).toLowerCase();
  const password = String(input.password ?? '');
  const name = cleanName(input.name);

  if (!email.includes('@')) return authFail('Ese correo no tiene un formato válido.');
  if (password.length < MIN_PASSWORD) return authFail(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
  if (name.length < MIN_NAME) return authFail(`El nombre necesita al menos ${MIN_NAME} letras.`);

  const admin = createAdminClient();

  // Se mira antes por cortesía: así el mensaje dice "ese nombre está cogido" en
  // vez de un error de clave duplicada. La defensa de verdad es el índice.
  try {
    const { data: free } = await admin.rpc('display_name_available', { wanted: name });
    if (free === false) return authFail('Ese nombre ya está cogido. Prueba con otro.');
  } catch {
    // Si la comprobación no responde se sigue: el índice decidirá.
  }

  let userId = '';

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });

    if (error || !data.user) return authFail(translate(error?.message ?? ''));
    userId = data.user.id;
  } catch (error) {
    console.error('[auth/signup] create', error);
    return authFail('No se ha podido crear la cuenta.');
  }

  // El disparador handle_new_user() ya ha creado el perfil con el nombre de los
  // metadatos; esto lo deja fijo y hace saltar el índice si estaba cogido.
  const { error: nameError } = await admin
    .from('profiles')
    .update({ display_name: name })
    .eq('id', userId);

  if (nameError) {
    // Media cuenta creada es peor que ninguna: se deshace.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);

    return authFail(
      String(nameError.message).includes('duplicate')
        ? 'Ese nombre ya está cogido. Prueba con otro.'
        : 'No se ha podido guardar el nombre.',
    );
  }

  try {
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });

    if (error || !data.session || !data.user) {
      return authFail('Cuenta creada, pero no se ha podido entrar. Prueba a iniciar sesión.');
    }

    return json(await sessionPayload(data.session, data.user));
  } catch (error) {
    console.error('[auth/signup] signin', error);
    return authFail('Cuenta creada. Entra con ella.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}

import type { Metadata } from 'next';
import { PUBLIC_CONFIG } from '@/lib/config';
import { Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description: 'Qué datos recoge el juego, para qué se usan y cómo pedir que se borren.',
};

/**
 * Este texto describe lo que el sistema hace DE VERDAD, tal y como está
 * construido: Supabase para cuentas y progreso, sin rastreadores, sin
 * publicidad y sin venta de datos. Si algún día se añade analítica o anuncios,
 * hay que actualizar esta página el mismo día, no después.
 *
 * No sustituye al criterio de un abogado si el juego llega a distribuirse a
 * gran escala.
 */
export default function PrivacyPage() {
  return (
    <Section kicker="Legal" title="Política de privacidad">
      <div className="prose-casino max-w-3xl space-y-8 text-sm leading-relaxed text-slate-300">
        <p className="text-slate-400">
          Última actualización: {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>

        <Block title="Lo corto">
          <p>
            Si juegas sin cuenta, no se envía nada a ningún servidor: la partida vive en tu
            dispositivo. Si creas una cuenta, se guardan tu correo, tu nombre de jugador y
            tu progreso, y nada más. No hay publicidad, no hay rastreadores y no se venden
            datos a nadie.
          </p>
        </Block>

        <Block title="Qué datos se recogen">
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>Sin cuenta:</strong> nada. El juego guarda la partida en el
              almacenamiento del propio dispositivo.
            </li>
            <li>
              <strong>Con cuenta:</strong> el correo electrónico con el que te registras
              (o el que nos facilita Google o Apple al iniciar sesión), un identificador
              interno, tu nombre de jugador, tu avatar, tu código de amigo y tu progreso
              del juego (saldo ficticio, estadísticas y partidas jugadas).
            </li>
            <li>
              <strong>Al comprobar actualizaciones:</strong> el juego consulta la versión
              disponible. Esa petición incluye la versión instalada y la plataforma; no
              lleva ningún identificador personal.
            </li>
          </ul>
        </Block>

        <Block title="Para qué se usan">
          <p>
            Únicamente para que el juego funcione: identificarte al iniciar sesión,
            devolverte tu progreso en otro dispositivo, mostrar la clasificación y la lista
            de amigos, y avisarte de que hay una versión nueva. No se usan para
            publicidad ni para elaborar perfiles.
          </p>
        </Block>

        <Block title="Dónde se guardan">
          <p>
            En Supabase, que aloja los datos en servidores dentro de la Unión Europea.
            La conexión va siempre cifrada (HTTPS) y el acceso a la base de datos está
            restringido por reglas que impiden que una cuenta vea los datos de otra.
          </p>
        </Block>

        <Block title="Cuánto tiempo">
          <p>
            Mientras la cuenta exista. Si pides que se borre, se eliminan la cuenta y todo
            el progreso asociado, sin copia posterior.
          </p>
        </Block>

        <Block title="Cookies">
          <p>
            Esta web usa <strong>solo</strong> las cookies necesarias para mantener la
            sesión iniciada. No hay cookies de analítica ni de publicidad, y por eso no
            aparece ningún aviso de consentimiento: la normativa europea no lo exige para
            las cookies estrictamente necesarias.
          </p>
          <p>
            Si en el futuro se añade analítica, será una opción que haya que aceptar
            explícitamente, y esta página se actualizará antes de activarla.
          </p>
        </Block>

        <Block title="Menores">
          <p>
            El juego está dirigido a mayores de 18 años. Aunque no se puede apostar dinero
            real, reproduce mecánicas de azar y no es apropiado para menores.
          </p>
        </Block>

        <Block title="Tus derechos">
          <p>
            Puedes pedir acceso a tus datos, su corrección, su borrado o una copia en
            formato legible. Escribe a{' '}
            <a href={`mailto:${PUBLIC_CONFIG.SUPPORT_EMAIL}`} className="text-gold-400 hover:text-gold-300">
              {PUBLIC_CONFIG.SUPPORT_EMAIL}
            </a>{' '}
            desde el correo de la cuenta y se resuelve en un plazo máximo de 30 días.
          </p>
        </Block>
      </div>
    </Section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="heading mb-3 text-lg">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

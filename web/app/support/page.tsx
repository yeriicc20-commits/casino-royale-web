import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLIC_CONFIG } from '@/lib/config';
import { Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Ayuda',
  description: 'Preguntas frecuentes sobre instalación, cuentas, actualizaciones y progreso.',
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Android dice que el archivo puede ser peligroso. ¿Lo es?',
    a: 'Es el aviso que Android muestra con cualquier aplicación que no venga de Google Play, independientemente de quién la haya hecho. Mientras descargues el APK desde esta web, es el archivo oficial. Si algún día se publica en Google Play, el aviso desaparecerá.',
  },
  {
    q: 'No me deja instalar: «Aplicación no segura bloqueada».',
    a: 'Es Play Protect. Pulsa en «Más detalles» y luego en «Instalar de todos modos». Puedes volver a activar la comprobación después sin problema.',
  },
  {
    q: '¿Por qué no hay descarga directa para iPhone?',
    a: 'Porque Apple no lo permite. Fuera de TestFlight y de los programas de empresa, una aplicación de iOS solo se instala desde App Store. Poner un enlace a un archivo .ipa no serviría de nada: el iPhone lo rechazaría.',
  },
  {
    q: '¿Necesito cuenta para jugar?',
    a: 'No. Todas las mesas funcionan sin conexión y sin cuenta. La cuenta sirve para que tu progreso te siga a otro dispositivo y para la lista de amigos y la clasificación.',
  },
  {
    q: 'He cambiado de móvil. ¿Pierdo mi progreso?',
    a: 'Si jugabas con cuenta, no: inicia sesión en el móvil nuevo y tu saldo y estadísticas aparecerán. Si jugabas sin cuenta, la partida estaba solo en el dispositivo anterior y no se puede recuperar.',
  },
  {
    q: 'El juego me pide actualizar para jugar online.',
    a: 'Significa que tu versión ya no es compatible con el servidor. Descarga la última desde la página de descargas; el modo sin conexión sigue funcionando mientras tanto, así que no pierdes nada.',
  },
  {
    q: '¿Puedo comprar monedas o retirar mis ganancias?',
    a: 'No, ni una cosa ni la otra. El saldo es ficticio y no existe ninguna forma de ingresar ni de retirar dinero. No hay compras dentro del juego.',
  },
  {
    q: 'Quiero borrar mi cuenta y mis datos.',
    a: 'Escríbenos desde el correo de la cuenta y la eliminaremos junto con todo el progreso asociado.',
  },
];

export default function SupportPage() {
  return (
    <Section kicker="Ayuda" title="Preguntas frecuentes">
      <div className="max-w-3xl space-y-3">
        {FAQ.map((item) => (
          <details key={item.q} className="panel group p-0">
            <summary className="cursor-pointer list-none p-5 text-sm font-semibold text-slate-100 transition-colors hover:text-gold-300">
              <span className="flex items-start justify-between gap-4">
                {item.q}
                <span aria-hidden className="mt-0.5 flex-none text-gold-500 transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="border-t border-white/8 p-5 text-sm leading-relaxed text-slate-400">
              {item.a}
            </p>
          </details>
        ))}
      </div>

      <div className="panel-gold mt-10 max-w-3xl p-7">
        <h2 className="heading text-lg">¿No has encontrado lo que buscabas?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Escríbenos y te respondemos. Si es un error del juego, dinos qué versión tienes y
          qué móvil usas: sin eso es muy difícil reproducirlo.
        </p>
        <a href={`mailto:${PUBLIC_CONFIG.SUPPORT_EMAIL}`} className="btn-gold mt-5">
          {PUBLIC_CONFIG.SUPPORT_EMAIL}
        </a>
      </div>

      <p className="mt-8 text-sm text-slate-500">
        ¿Buscabas las novedades de la última versión?{' '}
        <Link href="/updates" className="text-gold-400 hover:text-gold-300">Míralas aquí</Link>.
      </p>
    </Section>
  );
}

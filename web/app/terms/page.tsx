import type { Metadata } from 'next';
import { PUBLIC_CONFIG } from '@/lib/config';
import { Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Términos y condiciones',
  description: 'Condiciones de uso del juego y de esta web.',
};

export default function TermsPage() {
  return (
    <Section kicker="Legal" title="Términos y condiciones">
      <div className="max-w-3xl space-y-8 text-sm leading-relaxed text-slate-300">
        <p className="text-slate-400">
          Última actualización: {new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>

        <Block title="1. Qué es este juego">
          <p>
            {PUBLIC_CONFIG.GAME_NAME} es un juego de entretenimiento que reproduce mesas de
            casino. El saldo con el que se juega es <strong>dinero ficticio</strong>, no
            tiene ningún valor económico y no puede canjearse por dinero ni por bienes.
          </p>
          <p>
            No hay compras dentro del juego, no se puede ingresar dinero y no se puede
            retirar nada. Ganar o perder en el juego no tiene ninguna consecuencia
            económica.
          </p>
        </Block>

        <Block title="2. Edad mínima">
          <p>
            Para usar el juego hay que tener 18 años o más. Aunque no se apueste dinero
            real, las mecánicas son de azar.
          </p>
        </Block>

        <Block title="3. Tu cuenta">
          <p>
            Eres responsable de mantener el acceso a tu cuenta. Si crees que alguien ha
            entrado en ella, avísanos.
          </p>
          <p>
            Podemos suspender una cuenta que modifique el cliente del juego para obtener
            ventaja, que intente atacar el servicio o que suplante a otra persona.
          </p>
        </Block>

        <Block title="4. Sin conexión y con conexión">
          <p>
            El modo sin conexión funciona sin cuenta y sin red. El modo online requiere una
            cuenta y una versión del juego compatible con el servidor; cuando el protocolo
            cambia, las versiones antiguas dejan de poder conectarse hasta que se
            actualicen. Eso no afecta al modo sin conexión.
          </p>
        </Block>

        <Block title="5. Disponibilidad">
          <p>
            El servicio online se ofrece tal cual, sin garantía de disponibilidad
            ininterrumpida. Puede haber mantenimientos, y puede interrumpirse de forma
            permanente avisando con antelación razonable. El juego sin conexión seguirá
            funcionando en el dispositivo donde esté instalado.
          </p>
        </Block>

        <Block title="6. Progreso del juego">
          <p>
            El progreso guardado en el servidor se conserva mientras la cuenta exista.
            Hacemos copias de seguridad, pero no podemos garantizar la recuperación de una
            partida en todos los casos. Un progreso guardado solo en el dispositivo se
            pierde si ese dispositivo se pierde o se borra.
          </p>
        </Block>

        <Block title="7. Propiedad">
          <p>
            El juego, su código, su arte y su nombre pertenecen a su autor. Puedes usar la
            aplicación; no puedes redistribuirla modificada, descompilarla para publicar
            copias ni usar su material en otro producto.
          </p>
        </Block>

        <Block title="8. Distribución en Android">
          <p>
            El archivo de instalación se ofrece desde esta web porque el juego todavía no
            está en Google Play. Descárgalo solo desde aquí: no podemos responder de copias
            alojadas en otros sitios, que pueden haber sido modificadas.
          </p>
        </Block>

        <Block title="9. Cambios">
          <p>
            Estas condiciones pueden cambiar. Si el cambio es relevante, se avisará en la
            web y dentro del juego antes de que entre en vigor.
          </p>
        </Block>

        <Block title="10. Contacto">
          <p>
            Para cualquier cuestión sobre estas condiciones, escribe a{' '}
            <a href={`mailto:${PUBLIC_CONFIG.SUPPORT_EMAIL}`} className="text-gold-400 hover:text-gold-300">
              {PUBLIC_CONFIG.SUPPORT_EMAIL}
            </a>.
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

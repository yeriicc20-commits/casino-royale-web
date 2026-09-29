import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLIC_CONFIG } from '@/lib/config';
import { FeatureCard, Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'El juego',
  description: 'Qué mesas hay, cómo funciona el modo sin conexión y qué aporta jugar con cuenta.',
};

const MESAS: [string, string, string, string][] = [
  ['Tragaperras Royale', '5 carretes · 10 líneas', 'Comodines que sustituyen, dispersos que regalan tiradas y un BAR que paga 2.000×.', '96,3 %'],
  ['Ruleta europea', 'Un solo cero', 'Pleno, docenas, columnas y suertes sencillas sobre el tapete completo.', '97,3 %'],
  ['Blackjack', 'Planta, dobla y separa', 'Contra el crupier, hasta 21. El blackjack paga 3 a 2.', '99,5 %'],
  ['Vídeo póker', 'Jacks or Better', 'Cinco cartas, descarte y una tabla que premia la escalera real.', '99,5 %'],
  ['Crash', 'Retira antes de que estalle', 'El multiplicador sube. Tú decides cuándo bajarte.', '97 %'],
  ['Minas', 'Destapa sin tocar una mina', 'Cada casilla segura sube el multiplicador. Retírate cuando quieras.', '97 %'],
  ['Plinko', 'Tres niveles de riesgo', 'La bola rebota por la pirámide y cae en una casilla de premio.', '97 %'],
  ['Keno', 'Elige hasta diez números', 'Se sortean veinte de ochenta. Cuantos más aciertes, más paga.', '96 %'],
];

export default function GamePage() {
  return (
    <>
      <Section
        kicker="El juego"
        title={PUBLIC_CONFIG.GAME_NAME}
        lead="Un casino de bolsillo con reglas de verdad. Las probabilidades están publicadas mesa a mesa, porque un juego que esconde su RTP es un juego del que desconfiar."
      >
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Mesas disponibles y su retorno al jugador</caption>
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-3.5">Mesa</th>
                <th scope="col" className="hidden px-5 py-3.5 sm:table-cell">Cómo se juega</th>
                <th scope="col" className="px-5 py-3.5 text-right">RTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {MESAS.map(([name, tagline, description, rtp]) => (
                <tr key={name} className="bg-ink-900/50 transition-colors hover:bg-ink-800/60">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-white">{name}</p>
                    <p className="mt-0.5 text-xs text-gold-400/80">{tagline}</p>
                    <p className="mt-1 text-xs text-slate-400 sm:hidden">{description}</p>
                  </td>
                  <td className="hidden px-5 py-4 text-slate-400 sm:table-cell">{description}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-display font-bold text-gold-300">
                    {rtp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          RTP (<em>return to player</em>) es el porcentaje que una mesa devuelve a largo plazo.
          Es una media sobre millones de jugadas, no una promesa sobre tu sesión.
        </p>
      </Section>

      <Section kicker="Cómo funciona" title="Sin conexión y con conexión">
        <div className="grid gap-5 md:grid-cols-2">
          <FeatureCard icon={<span className="text-xl">📴</span>} title="Sin conexión">
            Todas las mesas funcionan sin red y sin cuenta. La partida se guarda en el
            propio dispositivo. Es el modo completo, no una demostración.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">🌐</span>} title="Con conexión">
            Añade que tu progreso te siga a otro móvil, la lista de amigos por código y la
            clasificación global. Necesita cuenta y una versión del juego al día.
          </FeatureCard>
        </div>

        <div className="panel mt-6 p-7">
          <h3 className="heading text-base">Por qué el online pide estar actualizado</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Cuando cambia la forma en que el juego y el servidor se hablan, una versión
            antigua ya no se entiende con el servidor nuevo. En lugar de dejar que falle de
            formas raras a mitad de partida, el juego lo detecta al arrancar y pide
            actualizar. El modo sin conexión sigue funcionando mientras tanto.
          </p>
        </div>
      </Section>

      <Section kicker="Lo importante" title="Esto no es un casino de dinero real">
        <div className="panel-gold max-w-3xl p-8">
          <p className="leading-relaxed text-slate-200">
            El saldo del juego es <strong>dinero ficticio</strong> y no tiene ningún valor
            fuera de la aplicación. No hay compras dentro del juego, no se puede ingresar
            dinero, y no se puede retirar nada. No existe ninguna forma de convertir el
            saldo en dinero real.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Aun así, es un juego con mecánicas de azar. Si el juego te preocupa a ti o a
            alguien cercano, en España puedes contactar con el teléfono de atención al
            jugador 900 200 225, gratuito y confidencial.
          </p>

          <Link href="/download" className="btn-gold mt-6">Descargar</Link>
        </div>
      </Section>
    </>
  );
}

/**
 * Nombres de usuario para los bots que parezcan elegidos por personas.
 *
 * No hay una lista cerrada de nombres: hay piezas (nombres, apellidos,
 * diminutivos, apodos de jugador, números, años) y patrones que las combinan
 * como lo haría alguien al registrarse ("marcos17", "AlexRivas", "Javi_22",
 * "xMatii", "PabloGG", "david_98"...). Solo con nombre + número ya salen más
 * de quince mil; con todos los patrones, cientos de miles.
 *
 * Reglas: 3 a 16 caracteres (lo que guarda online_players.name), solo letras,
 * números y guion bajo, nada que delate a un bot y nunca uno ya cogido.
 */
import { chance, pick, randInt, weighted, type Rng } from './random';

export const FIRST_NAMES = [
  'Alex', 'Alejandro', 'Adrian', 'Alberto', 'Alvaro', 'Andres', 'Angel', 'Antonio', 'Arturo', 'Bruno',
  'Carlos', 'Cesar', 'Cristian', 'Daniel', 'David', 'Diego', 'Eduardo', 'Emilio', 'Enrique', 'Eric',
  'Esteban', 'Fabian', 'Felipe', 'Fernando', 'Francisco', 'Gabriel', 'Gonzalo', 'Guillermo', 'Hector', 'Hugo',
  'Ignacio', 'Ismael', 'Ivan', 'Jaime', 'Javier', 'Jesus', 'Joel', 'Jorge', 'Jose', 'Juan',
  'Julian', 'Kevin', 'Leo', 'Leonardo', 'Lucas', 'Luis', 'Manuel', 'Marc', 'Marco', 'Marcos',
  'Mario', 'Martin', 'Mateo', 'Matias', 'Miguel', 'Mikel', 'Nicolas', 'Oscar', 'Pablo', 'Pedro',
  'Rafael', 'Ramon', 'Raul', 'Ricardo', 'Roberto', 'Rodrigo', 'Ruben', 'Samuel', 'Santiago', 'Sergio',
  'Thiago', 'Tomas', 'Victor', 'Xavier', 'Yeray', 'Aitor', 'Asier', 'Iker', 'Unai', 'Gorka',
  'Pau', 'Jordi', 'Oriol', 'Arnau', 'Biel', 'Eloy', 'Izan', 'Dario', 'Ezequiel', 'Facundo',
  'Gael', 'Liam', 'Axel', 'Nil', 'Joan', 'Borja', 'Cristobal', 'Gerard', 'Saul', 'Erik',
  'Lucia', 'Maria', 'Marta', 'Laura', 'Sara', 'Paula', 'Ana', 'Carla', 'Irene', 'Noelia',
  'Andrea', 'Elena', 'Nerea', 'Alba', 'Ainhoa', 'Rocio', 'Sofia', 'Valeria', 'Camila', 'Belen',
  'Lorena', 'Patricia', 'Silvia', 'Natalia', 'Claudia', 'Julia', 'Daniela', 'Martina', 'Raquel', 'Cristina',
  'Miriam', 'Sandra', 'Beatriz', 'Eva', 'Ines', 'Lola', 'Nuria', 'Marina', 'Adriana', 'Victoria',
  'Aitana', 'Carmen', 'Celia', 'Clara', 'Diana', 'Emma', 'Jimena', 'Lara', 'Mar', 'Olivia',
] as const;

export const SURNAMES = [
  'Rivas', 'Vega', 'Garcia', 'Lopez', 'Martin', 'Sanchez', 'Perez', 'Gomez', 'Ruiz', 'Diaz',
  'Moreno', 'Alonso', 'Romero', 'Navarro', 'Torres', 'Dominguez', 'Gil', 'Vazquez', 'Serrano', 'Blanco',
  'Molina', 'Castro', 'Ortiz', 'Rubio', 'Marin', 'Sanz', 'Iglesias', 'Nunez', 'Medina', 'Garrido',
  'Santos', 'Castillo', 'Cortes', 'Lozano', 'Guerrero', 'Cano', 'Prieto', 'Mendez', 'Cruz', 'Calvo',
  'Gallego', 'Vidal', 'Leon', 'Herrera', 'Marquez', 'Pena', 'Flores', 'Cabrera', 'Campos', 'Vega',
  'Fuentes', 'Carrasco', 'Diez', 'Caballero', 'Reyes', 'Nieto', 'Aguilar', 'Pascual', 'Santana', 'Herrero',
  'Lorenzo', 'Montero', 'Hidalgo', 'Gimenez', 'Ibanez', 'Ferrer', 'Duran', 'Santiago', 'Benitez', 'Mora',
  'Vicente', 'Arias', 'Varela', 'Soler', 'Roman', 'Pastor', 'Velasco', 'Bravo', 'Rojas', 'Parra',
] as const;

export const DIMINUTIVES = [
  'Javi', 'Dani', 'Rodri', 'Fran', 'Nacho', 'Pepe', 'Manu', 'Edu', 'Isma', 'Rafa',
  'Santi', 'Guille', 'Fer', 'Nico', 'Juanma', 'Josema', 'Kike', 'Chema', 'Paco', 'Quique',
  'Tito', 'Migue', 'Luisma', 'Toni', 'Sergi', 'Marti', 'Alvi', 'Gonza', 'Seba', 'Mati',
  'Raulito', 'Juanjo', 'Jaimito', 'Cris', 'Bea', 'Vero', 'Sofi', 'Vale', 'Cami', 'Lore',
  'Patri', 'Silvi', 'Nati', 'Andy', 'Lu', 'Mari', 'Tere', 'Isa', 'Ali', 'Gabi',
] as const;

/** Apodos de jugador: nada de "bot", "casino", "player" ni parecidos. */
export const ALIASES = [
  'Lobo', 'Tiburon', 'Fenix', 'Shadow', 'Ghost', 'Ninja', 'Rayo', 'Toro', 'Tigre', 'Puma',
  'King', 'Ace', 'Lucky', 'Neo', 'Zeus', 'Draco', 'Viper', 'Ronin', 'Kaiser', 'Bravo',
  'Flash', 'Rocky', 'Blaze', 'Storm', 'Halcon', 'Cobra', 'Pirata', 'Dragon', 'Titan', 'Rebel',
  'Joker', 'Duke', 'Maverick', 'Zorro', 'Oso', 'Leon', 'Buho', 'Cuervo', 'Rey', 'Crack',
  'Mago', 'Gitano', 'Kraken', 'Nova', 'Orion', 'Sniper', 'Turbo', 'Vortex', 'Wolf', 'Yeti',
] as const;

/** Lo que nunca puede aparecer en un nombre de bot (ni de broma). */
const FORBIDDEN = /(bot|test|player|casino|cpu|comput|admin|guest|user|npc|demo|fake|^ai(\d|_|$))/i;

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function lower(s: string) {
  return s.toLowerCase();
}

/** Alarga la última vocal o consonante como hace la gente: "Matii", "Rubenn". */
function stretch(name: string): string {
  return name + name[name.length - 1].toLowerCase();
}

function twoDigits(rng: Rng): string {
  return String(randInt(rng, 1, 99));
}

/** Años de nacimiento creíbles para un jugador: 1975..2007. */
function year(rng: Rng, long: boolean): string {
  const y = randInt(rng, 1975, 2007);
  return long ? String(y) : String(y).slice(2);
}

/** Números "con gracia" que la gente elige más que otros. */
function favoriteNumber(rng: Rng): string {
  return weighted(rng, [
    [twoDigits(rng), 6],
    [String(randInt(rng, 1, 9)), 3],
    [pick(rng, ['7', '10', '11', '13', '14', '17', '21', '22', '23', '33', '69', '77', '88', '99', '7']), 3],
    [String(randInt(rng, 100, 999)), 1],
  ]);
}

type Pattern = (rng: Rng) => string;

const PATTERNS: readonly (readonly [Pattern, number])[] = [
  // marcos17
  [(r) => lower(pick(r, FIRST_NAMES)) + favoriteNumber(r), 14],
  // Marcos17
  [(r) => pick(r, FIRST_NAMES) + favoriteNumber(r), 8],
  // AlexRivas
  [(r) => pick(r, FIRST_NAMES) + pick(r, SURNAMES), 10],
  // jrivas / JRivas
  [(r) => {
    const s = pick(r, FIRST_NAMES)[0] + pick(r, SURNAMES);
    return chance(r, 0.5) ? lower(s) : s;
  }, 5],
  // NicoR / AdrianM
  [(r) => pick(r, chance(r, 0.5) ? DIMINUTIVES : FIRST_NAMES) + pick(r, SURNAMES)[0], 9],
  // alexp
  [(r) => lower(pick(r, FIRST_NAMES) + pick(r, SURNAMES)[0]), 5],
  // Lobo77
  [(r) => pick(r, ALIASES) + favoriteNumber(r), 6],
  // xMatii / xDani
  [(r) => 'x' + (chance(r, 0.5) ? stretch(pick(r, DIMINUTIVES)) : pick(r, FIRST_NAMES)), 4],
  // PabloGG / FranGG
  [(r) => pick(r, chance(r, 0.5) ? DIMINUTIVES : FIRST_NAMES) + 'GG', 4],
  // Javi_22 / Joel_7
  [(r) => pick(r, chance(r, 0.5) ? DIMINUTIVES : FIRST_NAMES) + '_' + favoriteNumber(r), 7],
  // Rodri10
  [(r) => pick(r, DIMINUTIVES) + favoriteNumber(r), 8],
  // david_98 / dani2003
  [(r) => {
    const n = lower(pick(r, chance(r, 0.6) ? FIRST_NAMES : DIMINUTIVES));
    return chance(r, 0.6) ? n + '_' + year(r, false) : n + year(r, chance(r, 0.4));
  }, 8],
  // Rubenn / Matii
  [(r) => stretch(pick(r, FIRST_NAMES)), 3],
  // ivanx
  [(r) => lower(pick(r, FIRST_NAMES)) + 'x', 2],
  // Raulito / Danii
  [(r) => {
    const n = pick(r, FIRST_NAMES);
    return /[aeiou]$/i.test(n) ? n.slice(0, -1) + 'ito' : n + 'ito';
  }, 2],
  // LoboDani
  [(r) => pick(r, ALIASES) + pick(r, DIMINUTIVES), 2],
  // dani_vega
  [(r) => lower(pick(r, DIMINUTIVES)) + '_' + lower(pick(r, SURNAMES)), 3],
  // MarioV
  [(r) => pick(r, FIRST_NAMES) + pick(r, SURNAMES)[0].toUpperCase(), 4],
];

/** Un nombre candidato (puede estar cogido; para eso está generateUsername). */
export function candidateUsername(rng: Rng): string {
  const make = weighted(rng, PATTERNS);
  let name = make(rng).replace(/[^A-Za-z0-9_]/g, '');
  if (name.length > 16) name = name.slice(0, 16);
  return name;
}

export function isAcceptableUsername(name: string): boolean {
  return NAME_RE.test(name) && !FORBIDDEN.test(name) && !/^\d+$/.test(name) && !/^_|_$/.test(name);
}

/**
 * Un nombre libre. `taken` va en minúsculas: "DaniVega" y "danivega" son el
 * mismo nombre para una persona que lo lee en la clasificación.
 */
export function generateUsername(rng: Rng, taken: Set<string>): string | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = candidateUsername(rng);
    if (!isAcceptableUsername(name)) continue;
    if (taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    return name;
  }
  return null;
}

/**
 * Cuántos nombres distintos puede llegar a dar el generador (una cota por
 * debajo: solo cuenta los patrones más simples). Para las pruebas y el panel.
 */
export function potentialPoolSize(): number {
  const f = FIRST_NAMES.length;
  const s = SURNAMES.length;
  const d = DIMINUTIVES.length;
  const a = ALIASES.length;
  return f * 99 /* marcos17 */ + f * s /* AlexRivas */ + (f + d) * s /* NicoR aprox */ + a * 99 + d * 99 + (f + d) * 99 /* Javi_22 */;
}

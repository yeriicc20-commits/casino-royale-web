/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // La version web del juego (Unity WebGL) vive en public/jugar.
  async rewrites() {
    return [{ source: '/jugar', destination: '/jugar/index.html' }, { source: '/jugar/', destination: '/jugar/index.html' }];
  },

  // Cabeceras de seguridad. Son gratis y evitan toda una familia de problemas.
  async headers() {
    return [
      {
        // Los archivos del juego llevan una huella en el nombre: se pueden guardar
        // en cache para siempre (una version nueva tiene nombres nuevos).
        source: '/jugar/Build/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/jugar/index.html',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // La API que consulta Unity: CORS abierto a proposito, porque no
        // devuelve nada privado y la consulta un cliente sin origen.
        source: '/api/game/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, X-Game-Version, X-Game-Platform' },
        ],
      },
    ];
  },
};

export default nextConfig;

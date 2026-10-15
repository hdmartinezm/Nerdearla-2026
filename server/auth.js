/**
 * Cognito authentication module.
 *
 * Flow:
 *  GET /        → requireAuth middleware → sin cookie → redirect a Cognito Hosted UI
 *  Cognito      → GET /callback?code=...
 *  /callback    → intercambia code por tokens → guarda id_token en cookie httpOnly → redirect a /
 *  GET /logout  → borra cookie → redirect a Cognito logout
 *
 * La cookie es httpOnly y session (expira al cerrar el browser).
 * El id_token JWT se valida con la JWKS pública de Cognito en cada request.
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const {
  COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  COGNITO_REGION,
  APP_URL,
  COOKIE_SECRET,
} = process.env;

const REDIRECT_URI = `${APP_URL}/callback`;
const COOKIE_NAME = 'nq_session';

// Cliente JWKS — cachea las claves públicas de Cognito
const jwks = jwksClient({
  jwksUri: `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600_000, // 10 minutos
});

/**
 * Obtiene la clave pública para verificar el JWT.
 */
function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Verifica y decodifica el id_token de Cognito.
 * Lanza error si el token es inválido o expirado.
 */
async function verifyToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('Token inválido');

  const signingKey = await getSigningKey(decoded.header);

  return jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`,
    audience: COGNITO_CLIENT_ID,
  });
}

/**
 * Middleware Express — protege rutas del organizador.
 * Si no hay cookie válida, redirige al Hosted UI de Cognito.
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return redirectToLogin(res);
  }

  try {
    const payload = await verifyToken(token);
    req.user = {
      sub: payload.sub,
      email: payload.email,
      username: payload['cognito:username'],
    };
    return next();
  } catch {
    // Token expirado o inválido — limpiar cookie y redirigir
    res.clearCookie(COOKIE_NAME);
    return redirectToLogin(res);
  }
}

/**
 * Middleware para Socket.IO — verifica el token enviado en el handshake.
 * Uso: io.use(requireAuthSocket)
 */
async function requireAuthSocket(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const payload = await verifyToken(token);
    socket.user = {
      sub: payload.sub,
      email: payload.email,
      username: payload['cognito:username'],
    };
    return next();
  } catch {
    return next(new Error('AUTH_INVALID'));
  }
}

/**
 * Ruta GET /callback
 * Cognito redirige aquí con ?code=... después del login.
 * Intercambia el code por tokens y guarda el id_token en cookie.
 */
async function handleCallback(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Código de autorización faltante.');
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: COGNITO_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
    });

    const { data } = await axios.post(
      `${COGNITO_DOMAIN}/oauth2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Guardar id_token en cookie httpOnly, session (sin maxAge = expira al cerrar browser)
    res.cookie(COOKIE_NAME, data.id_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: APP_URL.startsWith('https'),
    });

    return res.redirect('/');
  } catch (err) {
    console.error('[AUTH] Error en /callback:', err.response?.data || err.message);
    return res.status(500).send('Error al autenticar. Intenta de nuevo.');
  }
}

/**
 * Ruta GET /logout
 * Borra la cookie local y redirige al logout de Cognito.
 */
function handleLogout(req, res) {
  res.clearCookie(COOKIE_NAME);

  const logoutUrl =
    `${COGNITO_DOMAIN}/logout` +
    `?client_id=${COGNITO_CLIENT_ID}` +
    `&logout_uri=${encodeURIComponent(APP_URL + '/')}`;

  return res.redirect(logoutUrl);
}

/**
 * Redirige al Hosted UI de Cognito para hacer login.
 */
function redirectToLogin(res) {
  const loginUrl =
    `${COGNITO_DOMAIN}/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${COGNITO_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=openid+email+profile`;

  return res.redirect(loginUrl);
}

/**
 * Ruta GET /me — devuelve los datos del usuario autenticado (para el frontend).
 */
async function handleMe(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const payload = await verifyToken(token);
    return res.json({
      username: payload['cognito:username'],
      email: payload.email,
    });
  } catch {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}

module.exports = {
  requireAuth,
  requireAuthSocket,
  handleCallback,
  handleLogout,
  handleMe,
  verifyToken,
  COOKIE_NAME,
};

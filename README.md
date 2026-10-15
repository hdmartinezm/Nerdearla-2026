# ⚡ Nerdearla Quiz

Un juego de preguntas en tiempo real al estilo Kahoot, construido para Nerdearla 2026.

---

## 🚀 Cómo correrlo localmente

### 1. Requisitos

- **Node.js 18+** — verificá con `node -v`
- Si no lo tenés: https://nodejs.org

### 2. Instalar dependencias

```bash
cd /Users/verorivera/Documents/Code/Nerdearla-2026
npm install
```

### 3. Iniciar el servidor

```bash
npm start
```

Vas a ver:
```
🚀 Quiz server running at http://localhost:3000
   Organizer: http://localhost:3000/
   Players:   http://localhost:3000/play
```

### 4. Jugar

| Quién | URL |
|-------|-----|
| **Organizador** (vos, desde la PC) | `http://localhost:3000` |
| **Jugadores** (desde el celular, misma red WiFi) | `http://<IP-DE-TU-PC>:3000/play` |

> Para saber tu IP local en Mac: `ipconfig getifaddr en0`  
> Ejemplo: si tu IP es `192.168.1.50`, los jugadores entran a `http://192.168.1.50:3000/play`

---

## 🎮 Cómo funciona

### El organizador

1. Abrís `http://localhost:3000`
2. Creás las preguntas: texto, 4 opciones, marcás cuál es la correcta, elegís el tiempo límite
3. Hacés clic en **"Crear sala y obtener código"**
4. Aparece un código de 6 letras — compartilo con los jugadores
5. Esperás que se unan y apretás **"Iniciar partida"**
6. Durante cada pregunta ves en tiempo real cuántos respondieron
7. Podés avanzar manualmente con "Terminar pregunta ahora" si todos respondieron o querés saltear

### Los jugadores

1. Entran a la URL desde el celular
2. Ingresan el código y su nombre
3. Esperan en la sala hasta que el organizador inicie
4. Tocan la opción que creen correcta — más rápido = más puntos
5. Ven si acertaron y cuántos puntos sumaron
6. Al final ven el ranking completo con su posición

### Sistema de puntaje

- Respuesta correcta instantánea: **1000 puntos**
- Respuesta correcta al límite de tiempo: **100 puntos**
- El puntaje decrece linealmente según el tiempo que tardaste
- Respuesta incorrecta o no respondida: **0 puntos**

---

## 🗂 Estructura del proyecto

```
nerdearla-quiz/
├── server/
│   ├── app.js        # Express + Socket.IO, servidor principal
│   ├── game.js       # Lógica del juego: salas, scoring, ranking
│   └── socket.js     # Todos los eventos WebSocket
├── public/
│   ├── organizer.html / organizer.js   # Panel del organizador
│   ├── player.html   / player.js       # Vista del jugador (mobile-first)
│   └── style.css                       # Estilos compartidos
├── package.json
└── README.md
```

---

## ☁️ Deployment en AWS Elastic Beanstalk

El proyecto está configurado para correr en **AWS Elastic Beanstalk** con Node.js 22 en Amazon Linux 2023.

### Requisitos previos

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) instalado y configurado (`aws configure`)
- [EB CLI](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install.html) instalado (`pip install awsebcli`)

### Primer deploy (una sola vez)

```bash
eb init          # configura la app (plataforma Node.js 22, región, etc.)
eb create nerdearla-2026-env   # crea el entorno y hace el primer deploy (~3-5 min)
```

### Subir cambios

Cada vez que quieras desplegar una nueva versión:

```bash
eb deploy
```

### Abrir la app en el browser

```bash
eb open
```

### Ver logs en tiempo real

```bash
eb logs
```

### Bajar el entorno (para no generar costos)

Cuando no necesites el entorno activo (por ejemplo, después de la demo):

```bash
eb terminate nerdearla-2026-env
```

> ⚠️ Esto elimina todos los recursos del entorno (EC2, Load Balancer, etc.). Los datos en memoria se pierden. La **aplicación** en EB sigue existiendo, por lo que puedes volver a crear el entorno con `eb create` cuando lo necesites.

### Volver a subir el entorno después de bajarlo

```bash
eb create nerdearla-2026-env
```

O si quieres reutilizar la misma configuración con un entorno nuevo:

```bash
eb create nerdearla-2026-env-2
eb deploy
```

### Estados del entorno

| Comando | Qué hace |
|---------|----------|
| `eb status` | Muestra el estado actual del entorno |
| `eb health` | Muestra la salud de las instancias |
| `eb deploy` | Sube la versión más reciente del código |
| `eb terminate` | Elimina el entorno y detiene el cobro |

### ⚠️ Nota sobre escalabilidad horizontal

El estado del juego se guarda en memoria de Node.js. Las sticky sessions están habilitadas en el Load Balancer (configuradas en `.ebextensions/`), por lo que WebSockets funcionan correctamente.

Si en el futuro escalas a **múltiples instancias**, necesitarás agregar:

- **Redis** como store compartido (AWS ElastiCache)
- **socket.io-redis** adapter para sincronizar eventos entre instancias

Para una demostración en Nerdearla con una sola instancia, no hace falta nada de esto.

---

## 🛠 Desarrollo con hot-reload

```bash
npm run dev
```

Requiere `nodemon` (incluido en devDependencies).

---

## 🔐 Autenticación con Amazon Cognito

El panel del organizador (`/`) está protegido con Amazon Cognito. Los jugadores (`/play`) no necesitan autenticarse.

### Flujo de login

```
Organizador abre /
  → sin sesión → redirige al Hosted UI de Cognito
  → ingresa usuario y contraseña
  → Cognito redirige a /callback?code=...
  → el servidor intercambia el code por un id_token JWT
  → guarda el token en cookie httpOnly (expira al cerrar el browser)
  → redirige a / y carga el panel
```

### Configurar el User Pool en Cognito

1. Entra a la consola de AWS → **Cognito** → tu User Pool
2. En **App clients** → tu cliente → **Hosted UI**
3. Asegúrate de tener configurado:
   - **Allowed callback URL:** `http://tu-url/callback`
   - **Allowed sign-out URL:** `http://tu-url/`
   - **OAuth flows:** Authorization code grant ✅
   - **OAuth scopes:** `openid`, `email`, `profile` ✅
4. Para crear los administradores: **Users** → **Create user**

### Variables de entorno

Copia `.env.example` a `.env` y llena los valores:

```bash
cp .env.example .env
```

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default: `3000`) |
| `COGNITO_USER_POOL_ID` | ID del User Pool (ej: `us-east-1_xxxxxxx`) |
| `COGNITO_CLIENT_ID` | App Client ID de Cognito |
| `COGNITO_DOMAIN` | Hosted UI domain (ej: `https://xxx.auth.us-east-1.amazoncognito.com`) |
| `COGNITO_REGION` | Región AWS (ej: `us-east-1`) |
| `APP_URL` | URL pública de la app sin trailing slash |
| `COOKIE_SECRET` | String largo y aleatorio para firmar cookies |

### Configurar las variables en Elastic Beanstalk

Las variables de entorno **no se suben con el código** (el `.env` está en `.gitignore`). Debes configurarlas en EB:

```bash
eb setenv \
  COGNITO_USER_POOL_ID=us-east-1_xxxxxxx \
  COGNITO_CLIENT_ID=xxxxxxxxxx \
  COGNITO_DOMAIN=https://xxx.auth.us-east-1.amazoncognito.com \
  COGNITO_REGION=us-east-1 \
  APP_URL=http://tu-env.us-east-1.elasticbeanstalk.com \
  COOKIE_SECRET=tu-string-secreto-largo
```

O desde la consola: **Elastic Beanstalk** → tu entorno → **Configuration** → **Software** → **Environment properties**.

### Rutas de autenticación

| Ruta | Descripción |
|------|-------------|
| `GET /` | Panel del organizador (requiere login) |
| `GET /callback` | Callback de Cognito tras el login |
| `GET /logout` | Cierra sesión y redirige a Cognito logout |
| `GET /me` | Devuelve `{username, email}` del usuario autenticado |

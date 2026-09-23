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

## ☁️ Deployment en AWS

El proyecto está diseñado para correr en AWS. Estas son las opciones recomendadas:

### Opción A — EC2 (más simple)

1. Lanzar una instancia **EC2 Amazon Linux 2023** (t3.small o mayor)
2. Instalar Node.js 18+ con `nvm`
3. Copiar el proyecto (git clone o scp)
4. Instalar dependencias: `npm install --omit=dev`
5. Correr con **PM2** para que sobreviva reinicios:
   ```bash
   npm install -g pm2
   pm2 start server/app.js --name nerdearla-quiz
   pm2 save && pm2 startup
   ```
6. Abrir el puerto `3000` en el Security Group (o usar nginx como reverse proxy en el 80/443)

### Opción B — Elastic Beanstalk (más managed)

1. Crear un entorno Node.js en Beanstalk
2. El servidor usa `process.env.PORT` automáticamente (Beanstalk lo inyecta)
3. Zip del proyecto y subir desde la consola, o usar el CLI:
   ```bash
   eb init && eb deploy
   ```
4. **Importante con ALB:** habilitar **sticky sessions** en el Target Group  
   (WebSockets requieren que la misma instancia atienda la conexión)

### ⚠️ Nota sobre escalabilidad horizontal

El estado del juego se guarda en memoria de Node.js. Si escalás a **múltiples instancias**, necesitás agregar:

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

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT`   | `3000`  | Puerto en el que escucha el servidor |

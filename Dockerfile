# Image de déploiement Railway — API HTTP FrenchStream uniquement.
# (Le Dockerfile racine est l'image addon Home-Assistant avec overlay s6 :
#  inutilisable ici car son entrypoint relance index.js, pas l'API.)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY api-server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

ENV PORT=7001
EXPOSE 7001

CMD ["node", "api-server.js"]

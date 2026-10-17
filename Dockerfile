# Serves the prebuilt dist/ (run `pnpm build` first; `pnpm deploy` does both).
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080

FROM quote-gen-base:latest
COPY . .
CMD ["bun", "index.ts"]

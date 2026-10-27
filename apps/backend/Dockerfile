FROM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/backend ./cmd/go-boilerplate

FROM alpine:3.24

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/backend ./backend
COPY --from=build /src/static ./static
COPY --from=build /src/templates ./templates

USER app
EXPOSE 8080
STOPSIGNAL SIGINT
ENTRYPOINT ["./backend"]

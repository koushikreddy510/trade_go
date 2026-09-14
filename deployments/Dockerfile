# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /atlas ./cmd/atlas

# Runtime stage
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata curl

WORKDIR /app

COPY --from=builder /atlas /app/atlas
COPY configs/ /app/configs/
COPY scripts/ /app/scripts/
COPY test/testdata /app/test/testdata

ENV ATLAS_CONFIG=/app/configs/atlas.paper.yaml

ENTRYPOINT ["/app/atlas"]
CMD ["-config", "/app/configs/atlas.paper.yaml", "-serve"]

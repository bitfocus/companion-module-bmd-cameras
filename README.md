# companion-module-bmd-cameras

Bitfocus Companion module for Blackmagic camera REST/WebSocket control.

## How It Works

This module takes a **dynamic discovery** approach — instead of hardcoding endpoint definitions, it discovers the camera's API at runtime by parsing the OpenAPI/AsyncAPI YAML specs that every compatible Blackmagic camera exposes at `/control/documentation.html`.

### Connection Flow

1. Fetch the camera's documentation page, extract links to all YAML spec files
2. Fetch and parse all OpenAPI specs (typically 16 files) + the AsyncAPI WebSocket spec
3. Build an internal endpoint registry with paths, methods, schemas, and descriptions
4. Probe each GET endpoint to detect unsupported features (501/404 responses)
5. Fetch initial state for all supported endpoints (concurrency-limited to avoid overwhelming the camera)
6. Connect WebSocket using the path from the AsyncAPI spec, subscribe to all properties
7. Auto-generate Companion actions, variables, and feedbacks from the registry

### Why Dynamic Discovery

- **Zero maintenance** when Blackmagic releases firmware with new endpoints
- **Works across camera models** automatically — each camera declares what it supports
- **Single source of truth** — the camera's own specs, not our code
- **Unsupported features hidden** — endpoints returning 501/404 are probed and removed

### Action Generation

- Only endpoints with PUT/POST/DELETE methods become actions (mutations)
- GET-only endpoints become variables and feedbacks (data)
- Request body fields are built from OpenAPI schemas — enums become dropdowns, booleans become checkboxes
- "Supported values" endpoints (e.g., `/video/supportedISOs`) automatically populate dropdown choices for corresponding setter actions
- Nested schemas (like slate metadata) support read-merge-write to avoid clobbering unchanged fields, with per-path serialization for concurrent updates

### WebSocket

The WebSocket path is discovered from the camera's AsyncAPI spec (not hardcoded). Subscribe responses include current values, which populate the store immediately. Properties the camera can't subscribe to are automatically unsubscribed. Falls back to polling when WebSocket is unavailable.

## Tested Cameras

- **Blackmagic URSA Cine 12K LF** (firmware 9.5.3) — primary development/test camera

Other compatible cameras (PYXIS 6K, Cinema Camera 6K, Studio Cameras, URSA Broadcast G2, Micro Studio Camera 4K G2) should work via dynamic discovery but have not been tested. Camera-specific issues are expected — please report them.

## Configuration

See [HELP.md](./companion/HELP.md) for user-facing configuration details.

## Development

The module can be built once with `yarn build`. This should be enough to get the module to be loadable by Companion.

While developing the module, by using `yarn dev` the compiler will be run in watch mode to recompile the files on change.

## License

See [LICENSE](./LICENSE)

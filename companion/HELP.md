## Blackmagic Cameras

This module controls Blackmagic cameras using their built-in REST API and WebSocket notifications. On connect, the module automatically discovers what your camera supports and generates actions, variables, and feedbacks accordingly.

### Requirements

- Enable **Web media manager** in camera network settings (Blackmagic Camera Setup > Network Access).
- Set the camera's IP address in the module configuration.

### Tested Cameras

- Blackmagic URSA Cine 12K LF (firmware 9.5.3)

Other compatible cameras (PYXIS 6K, Cinema Camera 6K, Studio Cameras, URSA Broadcast G2, etc.) should work but have not been tested yet. If you encounter issues with a specific model, please report them.

### Configuration

| Setting                       | Default        | Description                                                                                                                                                                              |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera host or IP             | `127.0.0.1`    | The camera's IP address                                                                                                                                                                  |
| Port                          | `80`           | Network port                                                                                                                                                                             |
| Use HTTPS                     | Off            | Enable HTTPS transport                                                                                                                                                                   |
| Data fetch mode               | Eager          | **Eager**: fetches all data on connect. **Lazy**: only fetches data for variables/feedbacks you're actually using                                                                        |
| Unsupported endpoint handling | Probe and hide | **Probe and hide**: checks each endpoint on connect, hides ones the camera doesn't support (501/404). **Show all**: shows everything, errors displayed when unsupported actions are used |
| Polling interval              | `1000` ms      | How often to poll for updates when WebSocket is unavailable                                                                                                                              |
| Request timeout               | `4000` ms      | Timeout for HTTP requests to the camera                                                                                                                                                  |

### Actions

Actions are generated from the camera's own API specification. Only endpoints that change settings (PUT/POST) become actions — read-only endpoints are exposed as variables instead.

For endpoints with known supported values (like ISO, gain, ND filter, shutter), the action fields are populated as dropdowns with the camera's actual supported values. These update automatically when the camera's configuration changes.

Endpoints with nested data (like slate/clip metadata) support three action types:

- **Full update** — set all fields at once
- **Single field** — pick one field from a dropdown and set just that value

Both read the current state first and merge your changes, so unchanged fields are preserved.

### Variables

Variables are generated from all readable (GET) endpoints. Values update in real-time via WebSocket when available, falling back to polling otherwise.

Object-valued properties are split into individual sub-variables (e.g., `slates_nextClip_clip_clipName`, `slates_nextClip_clip_reel`) with a `_json` variant containing the raw JSON.

### Feedbacks

Boolean and value feedbacks are generated for all subscribable endpoints. Use boolean feedbacks to style buttons based on camera state (e.g., highlight a button when recording is active). Value feedbacks return current property values for use in expressions.

# YouTube download reliability

CineWall keeps extraction, format selection, streaming download and FFmpeg conversion on its own server. It does not depend on a random public downloader API.

## Research checked 29 October 2026

- [yt-dlp's EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS) requires a supported JavaScript runtime and matching EJS scripts. Node 22+ is supported. Official Windows executables include EJS; the Docker install uses `yt-dlp[default]` and Node 24.
- [yt-dlp's update guidance](https://github.com/yt-dlp/yt-dlp#update) recommends current builds, including its nightly channel, because websites change between releases. This laptop initially had `2026.09.27.232945`; it was updated through official SHA-256 verification to stable `2026.10.26` during this work.
- [Extractor options](https://github.com/yt-dlp/yt-dlp#extractor-arguments) document default client selection and warn that skipping player webpage/config requests can lose metadata or formats. CineWall's transport fallbacks retain default clients and metadata instead of forcing the embedded client and skipping those requests.
- [Cobalt's public source](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/youtube.js) and [API documentation](https://github.com/imputnet/cobalt/blob/main/docs/api.md) show a maintained extraction/proxy/remux backend. Its public service is not an unrestricted API for third-party applications. Similar server-side processing is an architectural pattern, not proof that every YouTube link can be saved.
- [YouTube extractor notes](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube) describe upstream token and availability restrictions. CineWall stops on access/rate-limit errors instead of repeatedly switching routes.

## Implemented recovery

Checks for the same video share one extraction and reuse public format metadata for two minutes. Closing or replacing the last interested request cancels its extraction; one cancelled caller cannot interrupt another caller sharing the same check. Downloads still refresh expired streams once, preserve the selected resolution/frame rate, and use only bounded same-quality alternatives. Transient metadata failures have bounded retries with delay. The tools endpoint checks yt-dlp, FFmpeg, FFprobe and the configured Node solver version.

The browser handles non-JSON gateway errors and request deadlines, ignores obsolete link checks, and retries safe metadata reads once. Download creation/loading is never blindly repeated. Progress polling backs off, stops on permanent errors, and offers Reconnect after repeated connection failures. Stored download recovery remains available when a transient network error occurs. Site storage restrictions no longer turn a successful start into a false error.

Sign-in checks, restricted content, upstream rate limits and some hosting networks can still prevent extraction. Local verification does not establish that a deployed host has the same outbound access or tool versions.

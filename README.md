# CineWall

CineWall turns two or three Windows laptops on the same local network into one synchronized video wall. Choose the movie once on the admin laptop; every screen receives it and follows the admin controls automatically.

## What you need

- Two or three Windows laptops for the movie wall (the admin can be one of them or a separate device)
- One DRM-free video file on the admin laptop
- All devices connected to the same Wi-Fi router, preferably 5 GHz
- Node.js 18 or newer on the laptop that will run the server
- Chrome or Microsoft Edge on all screens

Streaming services such as Netflix, Prime Video, and Disney+ are not supported because their protected video cannot be loaded as a local file or divided this way.

## Start the cinema

1. Extract the ZIP completely. Open the extracted folder and double-click **START CINEMA.cmd**. Keep the black window open.
2. If Windows Firewall asks, allow Node.js on **Private networks**.
3. Open the admin address shown in the black window. It is usually `http://localhost:4173/admin.html`. If that port is busy, the app automatically chooses the next available port and prints the correct address.
4. In the admin page, select **2 screens** or **3 screens**, then click **Choose movie** and select the movie on the admin laptop. Wait for the preparation bar to say **Ready**.
5. The admin page displays a screen address such as `http://192.168.1.20:4173/screen.html`. Open that exact address in Chrome or Edge on every screen laptop.
6. In two-screen mode choose **1 Left** and **2 Right**. In three-screen mode choose **1 Left**, **2 Centre**, and **3 Right**. Click **Enter fullscreen & make this screen ready** on each one.
7. Wait until the admin shows every screen ready, click **Identify all screens** to check the order, and press Play. All screens will play, pause, and seek automatically from the admin controls.

The app makes a temporary cached copy of the selected movie inside its `.cinema-cache` folder on the admin laptop. Selecting another movie replaces the previous cached copy.

### Which screen address should you use?

- If every laptop is connected to the same normal Wi-Fi router, use the **recommended Wi-Fi link** shown first.
- If the screen laptops are connected directly to the admin laptop's Windows Mobile Hotspot, use the separately labelled **Mobile Hotspot link**.
- The black server window must remain open. Closing it immediately disables every link.

## Framing modes

- **Fit** keeps the original picture shape. Because three screens are extremely wide, the picture may not use the entire wall.
- **Cinema crop** fills the whole wall without stretching, but crops a large amount from the top and bottom. This works best with specially prepared ultra-wide video.
- **Stretch** shows the whole picture across all three screens, but makes people and objects look wider.

For the best result, prepare video at the combined shape of the displays—for example, 3840×1080 for two 1920×1080 screens or 5760×1080 for three.

## Best results

- Use Ethernet if available; otherwise use a strong 5 GHz or 6 GHz Wi-Fi signal. The admin laptop streams the movie to every screen.
- Plug all laptops into power and turn off sleep, screen savers, and battery-saving mode.
- Set all displays to the same resolution, scaling, brightness, and color profile.
- Use only the centre laptop for audio, or connect that laptop to an external sound system.
- MP4 with H.264 video and AAC audio has the broadest browser support. MKV and HEVC support depends on the browser and installed Windows codecs.

## Stop the cinema

Return to the black server window and press `Ctrl+C`.

## Troubleshooting

- **Other laptops cannot open the screen address:** confirm all devices are on the same non-guest Wi-Fi and Node.js is allowed through Windows Firewall on private networks.
- **The screen shows “Connection lost” or freezes:** close the old page and open the exact current screen link printed by the active cinema-server window. Do not reuse a link from an older run if its port changed.
- **You cannot see the launcher:** first use Windows **Extract All** on the downloaded ZIP. The extracted folder contains a large, clearly named `START CINEMA.cmd` file.
- **The app says a port is already in use:** the updated version automatically tries another port. Always use the exact admin and screen addresses printed in the black window.
- **A screen says the video cannot play:** convert the file to MP4/H.264/AAC.
- **Playback permission message appears:** click the red permission button once on that laptop.
- **The screens drift:** use a stronger network, close background downloads, and keep the admin server on power. The app automatically corrects small timing differences every two seconds.
- **Audio echoes:** select only one audio source in the admin page.
- **All speakers:** choose **All speakers** in the admin page to play audio from every active laptop. Separate laptop speakers may create an echo because sound takes slightly different paths through the room; switch back to one speaker if that happens.

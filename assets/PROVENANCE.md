# Factory Environment Assets

## Entry Illustration

- Runtime image: `entry/carnival-entry.webp`.
- Original output: `entry/generated/0000_carnival-entry_0_0.png` (1376 x 768).
- Generator: user's installed `baichuan_api_image` plugin, `main.generate`, via the authorized API workflow; not the built-in image generator.
- Endpoint: `https://rivernexus.vip/v1`; model: `gpt-image-2.5-flare` from the refreshed authorized model list; 16:9, 1K, generated 2026-10-17.
- Final prompt: complete verbatim prompt in `scripts/entry-prompt.json`.
- No reference image was submitted for this illustration. The original composition was generated from this game's character and tank descriptions; it does not reconstruct the reference game's screenshot.
- Converted to RGB WebP at quality 87, metadata omitted. Title, progress bar and mode buttons are HTML, not generated lettering.
- The public release contains the runtime WebP, provenance and prompt, but not raw generation outputs or the image plugin/API credential.
- Character-only revision: the user's small-headed, round-bellied yellow character was supplied as an identity reference together with the original entry illustration as the edit target. Final edit prompt: `scripts/entry-character-prompt.json`; same plugin/model, standard multipart `/images/edits` (the gateway does not provide the plugin's optional reference-upload route). No installed plugin files were changed.
- Edited output: `entry/generated/0000_carnival-entry-character-v2_0_0.png`. Final master: `entry/generated/carnival-entry-character-v2-final.png`. Only a feathered polygon around the original character and its contact shadow was composited from the edit onto the original; pixels outside that region remain exactly the original before WebP compression. The tank, courtyard and page layout were preserved. The character-reference attachment is not stored in this project or its release.

## Reference

- User-requested reference game: https://nai-dou-luo.pages.dev/
- Style reference image passed to the image plugin: https://nai-dou-luo.pages.dev/assets/milk-world-v2.webp
- Old visual-study and branded QA screenshots have been removed from the workspace. They are not distribution assets.

## Background Music

- Local file: `audio/nai-dou-luo-battle.m4a`.
- Exact source: https://nai-dou-luo.pages.dev/assets/audio/bgm-loop.m4a
- Retrieved on 2026-10-17 at the user's explicit request. The original audio is unmodified.
- No license or authorship claim is made here. Confirm reuse rights with the source owner before public distribution.
- Combat sound effects remain the existing locally synthesized WebAudio effects.
- Mobile playback uses the browser's native media streaming and byte-range requests, routed through a dedicated WebAudio gain. The original M4A already has its metadata before the audio data and its bytes remain unchanged. Playback no longer waits for a complete fetch and decode.

## Generated Textures

- Generator: user's installed `baichuan_api_image` plugin, `main.generate`.
- Endpoint: `https://rivernexus.vip/v1`.
- Model: `gpt-image-2.5-flare-原生`, selected from the plugin's authorized models after the `gpt-image-2` channel returned unavailable.
- Mode: reference-image generation, 1:1, 1K; generated 2026-10-17.
- Final prompts: complete verbatim prompts are in `scripts/environment-prompts.json`.
- Original outputs: `textures/generated/0000_factory-floor_0_0.png` and `textures/generated/0000_factory-panel_0_0.png`.
- Runtime assets: `textures/factory-floor.webp` and `textures/factory-panel.webp`; converted to RGB WebP at quality 88, without visual edits.
- Floor: low-contrast sage-teal riveted metal plates for readable overhead combat.
- Panel: gold enamel panels, ivory bolted brackets and milk drips.
- Tanks, pipes, fittings, rails, gauges, plants, crates and lamps are native Three.js 3D geometry, not flattened scene images.
- Barrel revision: the user's tank reference informed six rounded yellow tanks with cream lids and curved belly patches, convex green eyes and glossy pupils, smiles, roof rails, warm lanterns and bolted pipe flanges. These models do not require additional image-generation calls. Private reference attachments are not included in the project.

# ViewModel

A small Fabric client mod for tuning how held items look, in the spirit of the
Feather Client view model editor.

- **Per hand first person offsets** &mdash; X / Y / Z, pitch / yaw / roll and scale,
  main hand and off hand kept separate.
- **Animation** &mdash; swing speed and how far the swing travels.
- **Third person placement** &mdash; per item rules, so a sword can hang on your waist
  or ride on your back instead of sticking out of your fist.
- **Blacklist** &mdash; items the mod never touches, so maps and spyglasses keep
  rendering the vanilla way.
- **Mod Menu compatible**, or open it with a key (`]` by default).

Everything is edited from one menu with live previews: the panel sits on the left
and the game keeps rendering and ticking behind it, so your hand moves while you
drag a slider.

## Requirements

| | |
|---|---|
| Minecraft | 26.3 |
| Loader | Fabric, loader 0.19.5+ |
| Java | 25 |
| Required | Fabric API 0.161.0+26.3 |
| Optional | Mod Menu |

Minecraft has shipped unobfuscated since 26.1, so this builds against the real
names with no Yarn or other mappings involved.

Client side only. Nothing is sent to the server: swing speed changes the local
animation, and the preview swings never leave your client.

## Build

```bash
./gradlew build          # jar lands in build/libs/
./gradlew runClient      # test it in a dev client
```

The first build downloads Minecraft and Fabric Loom, so it needs network access to
`maven.fabricmc.net` and Mojang's asset hosts. Gradle runs on **JDK 25** here; on
macOS that is `export JAVA_HOME=$(/usr/libexec/java_home -v 25)`.

## Using the menu

Press `]` in game, or go through Mod Menu's config button. `Esc` closes and saves.

### Sliders

| | |
|---|---|
| Drag | set the value, snapped to the step |
| Shift + drag | fine steps |
| Shift / Ctrl + wheel | nudge the hovered slider (a plain wheel scrolls the list) |
| Arrow keys | nudge the slider you last clicked |
| Right click | back to the default |

### Axes

Sliders always read the way you would say them out loud: **X is right, Y is up, Z
is forward**, in pixels (1/16 of a block). Rotations are degrees and pivot around
the view, which is what makes an item tilt in your grip rather than spin in place.

### Hands

Main hand and off hand have their own set of sliders. `Copy to off hand` clones the
main hand, `Mirror to off hand` clones it flipped, which is usually what you want
for a symmetric pair.

### Animation

`Swing speed` scales how long one swing lasts &mdash; 2.00x is twice as fast. It only
changes your own animation, not how fast you can actually hit anything. `Swing
amount` scales how far the item travels through the swing; 0.00x keeps it still.

Turn on `Auto swing` to keep the arm moving while you tune the numbers.

### Third person

Add a rule, pick the item, then choose what it attaches to:

- **Hand** &mdash; normal, just nudged by your offsets.
- **Waist, left / right** &mdash; on the hip, the classic sheathed sword look.
- **Back** &mdash; across the back.
- **Shoulder, left / right** &mdash; up near the shoulder.

Body anchors follow the torso, so the item stays put when you sneak. `Hold while in
use` snaps the item back into the hand while you swing or use it, so attacking
still looks right. The two preset buttons drop you somewhere sensible; the sliders
do the rest.

Two previews are available: the model box on the right of the page, and the real
thing &mdash; switch `View` to third person and your player is right there behind the
menu, updating as you drag.

### Blacklist

Any item in the blacklist renders exactly as vanilla does, in both first and third
person, and third person rules skip it too. `minecraft:filled_map` and
`minecraft:spyglass` start out blacklisted because vanilla already poses them in
special ways.

## Config file

`config/viewmodel.json`, written when the menu closes. Safe to hand edit; anything
out of range is clamped on load.

## Notes

- The menu deliberately does not pause singleplayer, otherwise nothing would
  animate while you tune it.
- Mixin targets are pinned to 26.3: `FirstPersonHandsAndItemsRenderer#submitArmWithItem`
  for the first person offsets, `LivingEntity#getCurrentSwingDuration` for swing speed,
  and `ItemInHandLayer#submitArmWithItem` plus `PlayerRenderer#extractRenderState` for
  third person placement. Moving Minecraft version means checking those four.
- Third person rendering works off render states, which no longer carry the entity or
  its item stacks, so `PlayerRendererMixin` copies the held item ids and an "in use"
  flag onto the render state (`HeldItemInfo`) for the item layer to read back.
- `gui/Compat.java` holds the few 26.3 calls that were hardest to pin down: the mouse
  button accessor, the GUI item icon call, and string trimming. If something in the
  menu does not compile, look there first.
- Mod Menu support is opt in. Set `modmenu_version` in `gradle.properties` to a build
  that exists for this Minecraft version and the config-screen entrypoint is compiled
  and registered; left empty, the mod builds without it and the `]` keybind is the way
  in. Their 26.3 build was still alpha when this was written.
- The build uses the `net.fabricmc.fabric-loom` plugin id, not `fabric-loom`. The
  latter is the remapping plugin and insists on a mappings dependency, which
  unobfuscated Minecraft no longer has.
- No license is declared yet. Add one to `fabric.mod.json` and drop a `LICENSE` file
  here before publishing the jar anywhere.

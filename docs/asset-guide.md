# Asset Guide

## Supported Formats

Deskpet can use:

- transparent PNG for still poses, fallbacks, and precise single-frame states;
- transparent animated WebP for looping actions such as idle, reading, music, sleeping, or celebration;
- future PNG sequences or sprite sheets when frame-level control is needed.

The current puppy PNG files are `1000 x 1000` RGBA images, which is a good source size. The renderer can scale them down for desktop display.

## Current Asset Folder

Current folder:

```text
puppy/
  manifest.json
  pet_01_flowers.png
  pet_01_flowers.webp
  pet_02_cycling.png
  pet_02_cycling.webp
  ...
```

Each PNG/WebP pair should represent the same pose or action:

- `.png`: stable fallback/poster image;
- `.webp`: animated version when available.

## Manifest Contract

Each pet has a manifest:

```json
{
  "id": "puppy",
  "displayName": "Puppy",
  "version": 1,
  "defaultScale": 0.32,
  "animationGroups": {
    "idle": ["music", "lying"],
    "interaction": ["idle_flowers", "firework"],
    "taskInProgress": ["cycling", "reading"],
    "taskCompleted": ["idle_flowers", "firework"]
  },
  "stateMappings": {
    "idle": ["music", "lying"],
    "in_progress": ["cycling", "reading"],
    "completed": ["idle_flowers", "firework"]
  },
  "actions": {
    "idle": {
      "label": "Idle",
      "still": "pet_01_flowers.png",
      "animated": "pet_01_flowers.webp",
      "loop": true,
      "weight": 4
    }
  }
}
```

Field meaning:

- `id`: stable pet id.
- `displayName`: name shown in UI.
- `defaultScale`: first-run visual scale.
- `animationGroups`: reusable animation pools for product behavior.
- `stateMappings`: maps logical task/editor states to one or more actions.
- `interactionMappings`: maps direct user interactions to actions.
- `actions`: named animation states.
- `still`: PNG fallback.
- `animated`: WebP animation.
- `loop`: whether the action can loop.
- `weight`: relative chance in random idle rotation.

## Current Puppy Groups

Current groups in `puppy/manifest.json`:

- Idle: `music`, `lying`, `accordion`, `autumn`.
- Task in progress: `cycling`, `reading`, `reading_alt`.
- Task completed: `idle_flowers`, `firework`.
- Interaction: click uses `idle_flowers` or `firework`; drag/drop uses `cycling`; sleep uses `lying`.

When you add new actions, choose the group by product meaning:

- calm ambient poses go into `animationGroups.idle`;
- direct touch/mouse reactions go into `interactionMappings`;
- coding, reading, running, waiting, searching, and chase/catch preparation go into task-coupled states;
- completion, success, flowers, fireworks, and reward animations go into `stateMappings.completed`.

## Action Naming

Use stable English action ids in the manifest. Display labels can be changed later without breaking code.

Recommended base actions:

- `idle`
- `walk`
- `sleep`
- `reading`
- `music`
- `celebrate`
- `rest`
- `seasonal`

Recommended future target actions:

- `target_notice`
- `target_chase`
- `target_catch`
- `target_success`
- `target_miss`
- `caterpillar_spawn`
- `caterpillar_catch`

Suggested future caterpillar mapping:

- `caterpillar_spawn`: `warning`, `error`, or a future `target_spawn` state;
- `caterpillar_chase`: `in_progress` or `running_command`;
- `caterpillar_catch`: `completed`;
- `caterpillar_miss`: `error` or `interrupted`.

## Adding A New Action

1. Add the image files to `puppy/`.
2. Use lowercase file names if possible.
3. Prefer matching PNG/WebP pairs:

```text
pet_10_caterpillar_spawn.png
pet_10_caterpillar_spawn.webp
```

4. Add an entry to `puppy/manifest.json`:

```json
{
  "label": "Caterpillar Spawn",
  "still": "pet_10_caterpillar_spawn.png",
  "animated": "pet_10_caterpillar_spawn.webp",
  "loop": false,
  "weight": 0
}
```

5. Validate JSON before committing:

```bash
node -e "JSON.parse(require('fs').readFileSync('puppy/manifest.json', 'utf8')); console.log('manifest ok')"
```

## When WebP Is Enough

Animated WebP is ideal for:

- ambient loops;
- idle variants;
- mood reactions;
- simple celebration;
- actions where exact frame timing does not need to trigger game logic.

## When To Use Frames Or Sprite Sheets

Use PNG sequences or sprite sheets when:

- a catch/hit moment must happen on a specific frame;
- the pet must collide with a target;
- the animation needs to pause, reverse, or branch;
- the renderer needs to know when an action has truly ended.

The first version can use WebP directly. The precise interaction system can come later.

## Size Guidance

Source art can stay large, such as `1000 x 1000`. Runtime display should scale down to roughly:

- small: 96-140 px tall;
- medium: 140-220 px tall;
- large: 220-320 px tall.

Keep future WebP files reasonably compressed. If the repository grows too large, add a packaging step or use Git LFS later.

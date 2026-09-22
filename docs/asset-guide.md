# Asset Guide

## Supported Formats

Deskpet can use:

- transparent PNG for base still poses and emergency fallbacks;
- transparent animated WebP for one-shot actions, transitions, reading, celebrations, and explicit loops;
- future PNG sequences or sprite sheets when frame-level control is needed.

The current puppy PNG files are `1000 x 1000` RGBA images, which is a good source size. The renderer can scale them down for desktop display.

Important runtime rule: most animated WebP files are played as finite action units, not as infinite loops. Deskpet plays the optional `enterAction`, then repeats the main animated WebP directly for the action's `repeatMin`/`repeatMax` range, then plays the optional `exitAction` and settles back to a base pose. Use `"loop": true` only for visuals that should keep moving until direct input ends, such as drag `sway`.

## Current Asset Folder

Current folder:

```text
puppy/
  manifest.json
  pet_11_ground.png
  pet_17_lie.png
  click_12_wave.webp
  click_13_petted.webp
  debug_10_caterpillar.webp
  debug_10_poke_bug.webp
  finish_01_flowers.webp
  finish_08_firework.webp
  move_sit_to_lift_1s.webp
  move_lie_to_lift_1s.webp
  move_16_sway.webp
  working_02_cycling.webp
  ...
```

Only base poses need PNG stills. For action, transition, task, and completion animations, prefer a single transparent animated WebP so the runtime can chain one animation into the next without switching to a mismatched still frame.

## Manifest Contract

Each pet has a manifest:

```json
{
  "id": "puppy",
  "displayName": "Puppy",
  "version": 5,
  "defaultScale": 0.32,
  "defaultAction": "sit",
  "defaultPose": "sit",
  "animationGroups": {
    "baseIdle": ["sit", "lie"],
    "idle": ["sit", "lie", "music", "lying", "accordion", "autumn"],
    "ambientIdle": ["music", "lying", "accordion", "autumn"],
    "interaction": ["wave", "petted"],
    "drag": ["sit_lift_up", "lie_lift_up", "sway", "put_down"],
    "taskInProgress": ["cycling", "reading", "reading_alt"],
    "taskCompleted": ["flowers", "firework"],
    "bug": ["caterpillar", "poke_bug"]
  },
  "poseTransitions": {
    "sit": { "lie": "sit_to_lie" },
    "lie": { "sit": "lie_to_sit" }
  },
  "clickMappings": {
    "sit": ["wave"],
    "lie": ["petted"],
    "ambient": ["sit", "lie", "music", "lying", "accordion", "autumn"]
  },
  "dragSequence": {
    "liftByPose": {
      "sit": "sit_lift_up",
      "lie": "lie_lift_up"
    },
    "dragging": "sway",
    "drop": "put_down",
    "returnPose": "sit"
  },
  "stateMappings": {
    "idle": ["sit", "lie"],
    "in_progress": ["cycling", "reading", "reading_alt"],
    "bug_hunt": ["caterpillar"],
    "completed": ["flowers", "firework"]
  },
  "actions": {
    "flowers": {
      "label": "Flowers",
      "animated": "finish_01_flowers.webp",
      "loop": false,
      "durationMs": 4074,
      "repeatMin": 2,
      "repeatMax": 5,
      "exitAction": "flowers_to_sit",
      "settleAction": "sit",
      "weight": 3
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
- `still`: PNG still for base poses, or an emergency fallback for actions that have no usable WebP.
- `animated`: WebP animation.
- `loop`: whether the action can loop.
- `durationMs`: how long to show a one-shot WebP before moving on.
- `repeatCount`: fixed number of animated WebP plays before exiting.
- `repeatMin` / `repeatMax`: random inclusive range for repeated animated WebP plays. Use this for main idle, working, and completion actions that should repeat 2-5 times.
- `fromPose`: required starting base pose, such as `sit` or `lie`.
- `nextPose`: pose after the action completes.
- `enterAction`: optional transition action before the main action.
- `exitAction`: optional transition action after the main action.
- `settleAction`: base action to display after the action chain finishes.
- `cycleNextAction`: optional next action to launch when the current logic state is still active. This is used by `bug_hunt` to alternate `caterpillar` and `poke_bug`.
- `weight`: relative chance in random idle rotation.

## Current Puppy Groups

Current groups in `puppy/manifest.json`:

- Base idle: `sit`, `lie`.
- Idle transitions: `sit_to_lie`, `lie_to_sit`.
- Ambient idle: `music`, `lying`, `accordion`, `autumn`.
- Click interactions: sitting uses `wave`; lying uses `petted`; other idle actions can randomize the idle state.
- Drag sequence: `sit_lift_up` or `lie_lift_up` first, `sway` loops while dragging, `put_down` plays after release and returns to `sit`.
- Task in progress: `cycling`, `reading`, `reading_alt`.
- Task completed: `flowers` or `firework`.
- Special bug-hunt state: `caterpillar` alternates with `poke_bug` through `cycleNextAction`.

When you add new actions, choose the group by product meaning:

- calm ambient poses go into `animationGroups.idle`;
- direct touch/mouse reactions go into `clickMappings`, `dragSequence`, or `interactionMappings`;
- coding, reading, running, waiting, searching, and chase/catch preparation go into task-coupled states;
- completion, success, flowers, fireworks, and reward animations go into `stateMappings.completed`.

For base pose actions, add `pose` to the action:

```json
{
  "sit": {
    "still": "pet_11_ground.png",
    "pose": "sit",
    "loop": true
  }
}
```

For one-shot transitions or reactions, add `durationMs` and `nextPose`:

```json
{
  "sit_to_lie": {
    "animated": "sit_to_lie_1s.webp",
    "loop": false,
    "durationMs": 1000,
    "fromPose": "sit",
    "nextPose": "lie"
  }
}
```

For ambient actions that need an entry and exit transition, keep the main action declarative:

```json
{
  "accordion": {
    "animated": "pet_06_accordion.webp",
    "loop": false,
    "durationMs": 4074,
    "fromPose": "sit",
    "enterAction": "sit_to_accordion",
    "exitAction": "accordion_to_sit",
    "settleAction": "sit"
  }
}
```

For main actions that should repeat several complete units before exiting, set a repeat range:

```json
{
  "reading": {
    "animated": "working_03_reading.webp",
    "loop": false,
    "durationMs": 4074,
    "repeatMin": 2,
    "repeatMax": 5
  }
}
```

For two non-looping WebP actions that should alternate while a state remains active, point each one at the other:

```json
{
  "caterpillar": {
    "animated": "debug_10_caterpillar.webp",
    "loop": false,
    "durationMs": 4074,
    "cycleNextAction": "poke_bug"
  },
  "poke_bug": {
    "animated": "debug_10_poke_bug.webp",
    "loop": false,
    "durationMs": 4074,
    "cycleNextAction": "caterpillar"
  }
}
```

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
3. Prefer a single transparent WebP for animated actions:

```text
debug_10_caterpillar_spawn.webp
```

4. Add an entry to `puppy/manifest.json`:

```json
{
  "label": "Caterpillar Spawn",
  "animated": "debug_10_caterpillar_spawn.webp",
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

- finite ambient actions;
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

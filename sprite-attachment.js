// Name: Sprite Attachment
// ID: spriteattachment
// Description: Attach sprites and clones into synchronized hierarchies.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Sprite Attachment must run unsandboxed");
  }

  const vm = Scratch.vm;
  const runtime = vm.runtime;
  const TargetType = Scratch.TargetType;

  const PARENT = Symbol.for("spriteattachment.parent");
  const CHILDREN = Symbol.for("spriteattachment.children");
  const LOCAL_X = Symbol.for("spriteattachment.localX");
  const LOCAL_Y = Symbol.for("spriteattachment.localY");
  const LOCAL_DIRECTION = Symbol.for("spriteattachment.localDirection");
  const CREATOR = Symbol.for("spriteattachment.creator");
  const TARGET_PATCHED = Symbol.for("spriteattachment.targetPatched");
  const CLONE_CREATOR_PATCHED = Symbol.for(
    "spriteattachment.cloneCreatorPatched"
  );
  const MAKE_CLONE_PATCHED = Symbol.for("spriteattachment.makeClonePatched");
  const DISPOSE_PATCHED = Symbol.for("spriteattachment.disposePatched");

  const updatingTargets = new Set();
  let pendingCreator = null;

  const russianTranslations = {
    "spriteattachment.name": "Привязка спрайтов",
    "spriteattachment.stageSelected": "Выбрана сцена: блоков нет",
    "spriteattachment.attachToSprite": "привязаться к [SPRITE]",
    "spriteattachment.attachToCreator": "привязаться к создателю",
    "spriteattachment.goToCreator": "перейти к создателю",
    "spriteattachment.detach": "отвязаться",
    "spriteattachment.detachChildren": "отвязать всех ведомых",
    "spriteattachment.isAttached": "привязан?",
  };

  Scratch.translate.setup({
    ru: russianTranslations,
    "ru-ru": russianTranslations,
  });

  const translate = (id, defaultMessage) =>
    Scratch.translate({
      id,
      default: defaultMessage,
    });

  const getChildren = (target) => {
    if (!target[CHILDREN]) {
      target[CHILDREN] = new Set();
    }
    return target[CHILDREN];
  };

  const rotateClockwise = (x, y, degrees) => {
    const radians = (degrees * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return [x * cosine + y * sine, -x * sine + y * cosine];
  };

  const captureLocalPosition = (target) => {
    const parent = target[PARENT];
    if (!parent) return;

    const [localX, localY] = rotateClockwise(
      target.x - parent.x,
      target.y - parent.y,
      90 - parent.direction
    );
    target[LOCAL_X] = localX;
    target[LOCAL_Y] = localY;
  };

  const captureLocalDirection = (target) => {
    const parent = target[PARENT];
    if (!parent) return;
    target[LOCAL_DIRECTION] = target.direction - parent.direction;
  };

  const detachTarget = (target) => {
    const parent = target && target[PARENT];
    if (!parent) return;
    getChildren(parent).delete(target);
    target[PARENT] = null;
  };

  const wouldCreateCycle = (target, parent) => {
    for (let ancestor = parent; ancestor; ancestor = ancestor[PARENT]) {
      if (ancestor === target) return true;
    }
    return false;
  };

  const attachTarget = (target, parent) => {
    if (
      !target ||
      !parent ||
      target.isStage ||
      parent.isStage ||
      target === parent ||
      !runtime.targets.includes(target) ||
      !runtime.targets.includes(parent) ||
      wouldCreateCycle(target, parent)
    ) {
      return false;
    }

    detachTarget(target);
    target[PARENT] = parent;
    getChildren(parent).add(target);
    captureLocalPosition(target);
    captureLocalDirection(target);
    return true;
  };

  const setXYUnfenced = (target, x, y) => {
    const oldX = target.x;
    const oldY = target.y;
    target.x = x;
    target.y = y;

    if (target.renderer && target.drawableID !== null) {
      target.renderer.updateDrawablePosition(target.drawableID, [x, y]);
      if (target.visible) {
        target.emitVisualChange();
        target.runtime.requestRedraw();
      }
    }
    if (target.onTargetMoved) {
      target.onTargetMoved(target, oldX, oldY, true);
    }
    target.runtime.requestTargetsUpdate(target);
  };

  const updateChildren = (parent) => {
    const children = parent[CHILDREN];
    if (!children) return;

    for (const child of [...children]) {
      if (child[PARENT] !== parent || !runtime.targets.includes(child)) {
        children.delete(child);
        continue;
      }

      const [offsetX, offsetY] = rotateClockwise(
        child[LOCAL_X],
        child[LOCAL_Y],
        parent.direction - 90
      );

      updatingTargets.add(child);
      try {
        setXYUnfenced(child, parent.x + offsetX, parent.y + offsetY);
        child.setDirection(parent.direction + child[LOCAL_DIRECTION]);
      } finally {
        updatingTargets.delete(child);
      }

      updateChildren(child);
    }
  };

  const patchTargetPrototype = () => {
    const sampleTarget = runtime.targets.find(
      (target) => target && !target.isStage
    );
    if (!sampleTarget) return;

    const prototype = sampleTarget.__proto__;
    if (prototype[TARGET_PATCHED]) return;

    const originalSetXY = prototype.setXY;
    const originalSetDirection = prototype.setDirection;
    const originalDispose = prototype.dispose;

    prototype.setXY = function (...args) {
      const result = originalSetXY.apply(this, args);
      if (!updatingTargets.has(this)) {
        captureLocalPosition(this);
        updateChildren(this);
      }
      return result;
    };

    prototype.setDirection = function (...args) {
      const result = originalSetDirection.apply(this, args);
      if (!updatingTargets.has(this)) {
        captureLocalDirection(this);
        updateChildren(this);
      }
      return result;
    };

    prototype.dispose = function (...args) {
      detachTarget(this);
      const children = this[CHILDREN];
      if (children) {
        for (const child of [...children]) {
          detachTarget(child);
        }
      }
      return originalDispose.apply(this, args);
    };

    prototype[TARGET_PATCHED] = true;
  };

  const patchCloneCreator = () => {
    const control = runtime.ext_scratch3_control;
    if (!control) return;

    if (!control[CLONE_CREATOR_PATCHED]) {
      const originalCreateClone = control._createClone;
      control._createClone = function (cloneOption, creator) {
        const previousCreator = pendingCreator;
        pendingCreator = creator;
        try {
          return originalCreateClone.call(this, cloneOption, creator);
        } finally {
          pendingCreator = previousCreator;
        }
      };
      control[CLONE_CREATOR_PATCHED] = true;
    }

    const sampleTarget = runtime.targets.find(
      (target) => target && !target.isStage
    );
    if (!sampleTarget) return;

    const prototype = sampleTarget.__proto__;
    if (prototype[MAKE_CLONE_PATCHED]) return;

    const originalMakeClone = prototype.makeClone;
    prototype.makeClone = function (...args) {
      const clone = originalMakeClone.apply(this, args);
      if (clone && pendingCreator) {
        clone[CREATOR] = pendingCreator;
      }
      return clone;
    };
    prototype[MAKE_CLONE_PATCHED] = true;
  };

  const patchDisposal = () => {
    if (runtime[DISPOSE_PATCHED]) return;

    const originalDisposeTarget = runtime.disposeTarget;
    const disposingTargets = new Set();

    const disposeWithChildren = (target) => {
      if (!target || disposingTargets.has(target)) return;
      disposingTargets.add(target);

      const children = target[CHILDREN];
      if (children) {
        for (const child of [...children]) {
          if (child.isOriginal) {
            detachTarget(child);
          } else {
            disposeWithChildren(child);
          }
        }
      }

      detachTarget(target);
      originalDisposeTarget.call(runtime, target);
      disposingTargets.delete(target);
    };

    runtime.disposeTarget = disposeWithChildren;
    runtime[DISPOSE_PATCHED] = true;
  };

  const initialize = () => {
    patchTargetPrototype();
    patchCloneCreator();
    patchDisposal();
  };

  runtime.on("targetWasCreated", initialize);
  runtime.on("PROJECT_LOADED", initialize);
  initialize();

  class SpriteAttachment {
    getInfo() {
      return {
        id: "spriteattachment",
        name: translate("spriteattachment.name", "Sprite Attachment"),
        color1: "#4c97ff",
        color2: "#3373cc",
        color3: "#2e65b0",
        blocks: [
          {
            blockType: Scratch.BlockType.LABEL,
            text: translate(
              "spriteattachment.stageSelected",
              "Stage selected: no blocks"
            ),
            filter: [TargetType.STAGE],
          },
          {
            opcode: "attachToSprite",
            blockType: Scratch.BlockType.COMMAND,
            text: translate(
              "spriteattachment.attachToSprite",
              "attach to [SPRITE]"
            ),
            arguments: {
              SPRITE: {
                type: Scratch.ArgumentType.STRING,
                menu: "sprites",
              },
            },
            filter: [TargetType.SPRITE],
          },
          {
            opcode: "attachToCreator",
            blockType: Scratch.BlockType.COMMAND,
            text: translate(
              "spriteattachment.attachToCreator",
              "attach to creator"
            ),
            filter: [TargetType.SPRITE],
          },
          {
            opcode: "goToCreator",
            blockType: Scratch.BlockType.COMMAND,
            text: translate(
              "spriteattachment.goToCreator",
              "go to creator"
            ),
            filter: [TargetType.SPRITE],
          },
          {
            opcode: "detach",
            blockType: Scratch.BlockType.COMMAND,
            text: translate("spriteattachment.detach", "detach"),
            filter: [TargetType.SPRITE],
          },
          {
            opcode: "detachChildren",
            blockType: Scratch.BlockType.COMMAND,
            text: translate(
              "spriteattachment.detachChildren",
              "detach all followers"
            ),
            filter: [TargetType.SPRITE],
          },
          {
            opcode: "isAttached",
            blockType: Scratch.BlockType.BOOLEAN,
            text: translate("spriteattachment.isAttached", "attached?"),
            disableMonitor: true,
            filter: [TargetType.SPRITE],
          },
        ],
        menus: {
          sprites: {
            acceptReporters: false,
            items: "getSprites",
          },
        },
      };
    }

    getSprites() {
      const sprites = runtime.targets
        .filter((target) => target && !target.isStage && target.isOriginal)
        .map((target) => target.getName());
      return sprites.length > 0 ? sprites : [""];
    }

    attachToSprite(args, util) {
      const parent = runtime.getSpriteTargetByName(args.SPRITE);
      attachTarget(util.target, parent);
    }

    attachToCreator(args, util) {
      attachTarget(util.target, util.target && util.target[CREATOR]);
    }

    goToCreator(args, util) {
      const target = util.target;
      const creator = target && target[CREATOR];
      if (!creator || !runtime.targets.includes(creator)) return;
      target.setXY(creator.x, creator.y);
    }

    detach(args, util) {
      detachTarget(util.target);
    }

    detachChildren(args, util) {
      const target = util.target;
      if (!target || !target[CHILDREN]) return;
      for (const child of [...target[CHILDREN]]) {
        detachTarget(child);
      }
    }

    isAttached(args, util) {
      return Boolean(util.target && util.target[PARENT]);
    }
  }

  Scratch.extensions.register(new SpriteAttachment());
})(Scratch);

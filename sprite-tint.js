// Name: Sprite Tint
// ID: spritetint
// Description: Overlay a sprite with a chosen color and opacity.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Sprite Tint must run unsandboxed");
  }

  const vm = Scratch.vm;
  const renderer = vm.renderer;
  const runtime = vm.runtime;
  const Cast = Scratch.Cast;
  const TargetType = Scratch.TargetType;
  const ShaderManager = renderer.exports.ShaderManager;
  const twgl = renderer.exports.twgl;

  const TINT = Symbol("spritetint.tint");

  const russianTranslations = {
    "spritetint.name": "Тонировка спрайта",
    "spritetint.stageSelected": "Выбрана сцена: блоков нет",
    "spritetint.setTint": "задать оттенок [COLOR] с плотностью [OPACITY]",
    "spritetint.clearTint": "сбросить оттенок",
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

  const vertexShader = `
    precision mediump float;

    uniform mat4 u_projectionMatrix;
    uniform mat4 u_modelMatrix;

    attribute vec2 a_position;
    attribute vec2 a_texCoord;

    varying vec2 v_texCoord;

    void main() {
      gl_Position = u_projectionMatrix * u_modelMatrix * vec4(a_position, 0, 1);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentShader = `
    precision mediump float;

    uniform sampler2D u_skin;
    uniform vec2 u_skinSize;
    uniform float u_color;
    uniform float u_brightness;
    uniform float u_fisheye;
    uniform float u_whirl;
    uniform float u_pixelate;
    uniform float u_mosaic;
    uniform float u_ghost;
    uniform float u_enableColor;
    uniform float u_enableBrightness;
    uniform vec3 u_tintColor;
    uniform float u_tintOpacity;

    varying vec2 v_texCoord;

    const float epsilon = 1e-3;
    const vec2 kCenter = vec2(0.5, 0.5);

    vec3 convertRGB2HSV(vec3 rgb) {
      const vec4 hueOffsets = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 temp1 = rgb.b > rgb.g ? vec4(rgb.bg, hueOffsets.wz) : vec4(rgb.gb, hueOffsets.xy);
      vec4 temp2 = rgb.r > temp1.x ? vec4(rgb.r, temp1.yzx) : vec4(temp1.xyw, rgb.r);
      float m = min(temp2.y, temp2.w);
      float C = temp2.x - m;
      float V = temp2.x;
      return vec3(abs(temp2.z + (temp2.w - temp2.y) / (6.0 * C + epsilon)), C / (temp2.x + epsilon), V);
    }

    vec3 convertHue2RGB(float hue) {
      float r = abs(hue * 6.0 - 3.0) - 1.0;
      float g = 2.0 - abs(hue * 6.0 - 2.0);
      float b = 2.0 - abs(hue * 6.0 - 4.0);
      return clamp(vec3(r, g, b), 0.0, 1.0);
    }

    vec3 convertHSV2RGB(vec3 hsv) {
      vec3 rgb = convertHue2RGB(hsv.x);
      float c = hsv.z * hsv.y;
      return rgb * c + hsv.z - c;
    }

    void main() {
      vec2 texcoord0 = v_texCoord;

      if (abs(u_mosaic - 1.0) > epsilon) {
        texcoord0 = fract(u_mosaic * texcoord0);
      }

      if (u_pixelate > epsilon) {
        vec2 pixelTexelSize = u_skinSize / u_pixelate;
        texcoord0 = (floor(texcoord0 * pixelTexelSize) + kCenter) / pixelTexelSize;
      }

      if (abs(u_whirl) > epsilon) {
        const float kRadius = 0.5;
        vec2 offset = texcoord0 - kCenter;
        float offsetMagnitude = length(offset);
        float whirlFactor = max(1.0 - (offsetMagnitude / kRadius), 0.0);
        float whirlActual = u_whirl * whirlFactor * whirlFactor;
        float sinWhirl = sin(whirlActual);
        float cosWhirl = cos(whirlActual);
        mat2 rotationMatrix = mat2(cosWhirl, -sinWhirl, sinWhirl, cosWhirl);
        texcoord0 = rotationMatrix * offset + kCenter;
      }

      if (abs(u_fisheye - 1.0) > epsilon) {
        vec2 vec = (texcoord0 - kCenter) / kCenter;
        float vecLength = length(vec);
        if (vecLength > epsilon) {
          float r = pow(min(vecLength, 1.0), u_fisheye) * max(1.0, vecLength);
          vec2 unit = vec / vecLength;
          texcoord0 = kCenter + r * unit * kCenter;
        }
      }

      gl_FragColor = texture2D(u_skin, texcoord0);

      if (u_enableColor > 0.5 || u_enableBrightness > 0.5) {
        gl_FragColor.rgb = clamp(gl_FragColor.rgb / (gl_FragColor.a + epsilon), 0.0, 1.0);

        if (u_enableColor > 0.5) {
          vec3 hsv = convertRGB2HSV(gl_FragColor.xyz);
          const float minLightness = 0.11 / 2.0;
          const float minSaturation = 0.09;
          if (hsv.z < minLightness) hsv = vec3(0.0, 1.0, minLightness);
          else if (hsv.y < minSaturation) hsv = vec3(0.0, minSaturation, hsv.z);
          hsv.x = mod(hsv.x + u_color, 1.0);
          if (hsv.x < 0.0) hsv.x += 1.0;
          gl_FragColor.rgb = convertHSV2RGB(hsv);
        }

        if (u_enableBrightness > 0.5) {
          gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(u_brightness), vec3(0), vec3(1));
        }

        gl_FragColor.rgb *= gl_FragColor.a + epsilon;
      }

      gl_FragColor *= u_ghost;

      vec3 straightColor = clamp(gl_FragColor.rgb / (gl_FragColor.a + epsilon), 0.0, 1.0);
      vec3 tintedColor = mix(straightColor, u_tintColor, u_tintOpacity);
      gl_FragColor = vec4(tintedColor * gl_FragColor.a, gl_FragColor.a);
    }
  `;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const hexToRgb = (hex) => {
    const normalized = Cast.toString(hex).trim();
    const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
    if (!match) {
      return [1, 0, 0];
    }
    const value = parseInt(match[1], 16);
    return [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
    ];
  };

  const requestVisualUpdate = (target) => {
    renderer.dirty = true;
    if (target.visible) {
      target.emitVisualChange();
      target.runtime.requestRedraw();
      target.runtime.requestTargetsUpdate(target);
    }
  };

  const setDrawableTint = (drawableID, tint) => {
    const drawable = renderer._allDrawables[drawableID];
    if (drawable) {
      drawable[TINT] = tint;
    }
  };

  const clearTargetTint = (target) => {
    if (!target || target.isStage) return;
    target[TINT] = null;
    if (target.drawableID !== null) {
      setDrawableTint(target.drawableID, null);
    }
    requestVisualUpdate(target);
  };

  const applyTargetTint = (target, tint) => {
    if (!target || target.isStage) return;
    target[TINT] = tint;
    if (target.drawableID !== null) {
      setDrawableTint(target.drawableID, tint);
    }
    requestVisualUpdate(target);
  };

  const patchClearEffects = () => {
    const proto = runtime.targets.find((target) => target && !target.isStage)?.__proto__;
    if (!proto || proto.__spriteTintPatched) return;
    proto.__spriteTintPatched = true;

    const clearEffects = proto.clearEffects;
    proto.clearEffects = function () {
      clearEffects.call(this);
      clearTargetTint(this);
    };

    const makeClone = proto.makeClone;
    proto.makeClone = function () {
      const clone = makeClone.call(this);
      if (clone && this[TINT]) {
        applyTargetTint(clone, {
          color: this[TINT].color.slice(),
          opacity: this[TINT].opacity,
        });
      }
      return clone;
    };
  };

  const patchDrawableTint = () => {
    if (renderer.updateDrawableTint) return;
    renderer.updateDrawableTint = setDrawableTint;

    const createDrawable = renderer.createDrawable;
    renderer.createDrawable = function (...args) {
      const drawableID = createDrawable.apply(this, args);
      setDrawableTint(drawableID, null);
      return drawableID;
    };

    const originalUpdateAll = runtime.targets.find((target) => target && !target.isStage)?.__proto__
      ?.updateAllDrawableProperties;
    if (originalUpdateAll && !originalUpdateAll.__spriteTintWrapped) {
      const proto = runtime.targets.find((target) => target && !target.isStage).__proto__;
      proto.updateAllDrawableProperties = function () {
        originalUpdateAll.call(this);
        if (this[TINT] && this.drawableID !== null) {
          setDrawableTint(this.drawableID, this[TINT]);
        }
      };
      proto.updateAllDrawableProperties.__spriteTintWrapped = true;
    }
  };

  const patchRenderer = () => {
    if (renderer.__spriteTintPatched) return;
    renderer.__spriteTintPatched = true;

    let programInfo = null;
    const getProgramInfo = () => {
      if (!programInfo) {
        programInfo = twgl.createProgramInfo(renderer.gl, [vertexShader, fragmentShader]);
      }
      return programInfo;
    };

    const originalDrawThese = renderer._drawThese;

    const drawTintedDrawable = function (drawableID, drawMode, projection, opts) {
      if (opts.filter && !opts.filter(drawableID)) return;

      const drawable = this._allDrawables[drawableID];
      const tint = drawable && drawable[TINT];
      if (!drawable || !tint || tint.opacity <= 0) return;
      if (!drawable.getVisible() && !opts.ignoreVisibility) return;
      if (!drawable.skin) return;
      if (opts.skipPrivateSkins && drawable.skin.private) return;

      const framebufferSpaceScaleDiffers =
        "framebufferWidth" in opts &&
        "framebufferHeight" in opts &&
        opts.framebufferWidth !== this._nativeSize[0] &&
        opts.framebufferHeight !== this._nativeSize[1];

      const drawableScale = framebufferSpaceScaleDiffers
        ? [
            (drawable.scale[0] * opts.framebufferWidth) / this._nativeSize[0],
            (drawable.scale[1] * opts.framebufferHeight) / this._nativeSize[1],
          ]
        : drawable.scale;

      if (!drawable.skin.getTexture(drawableScale)) return;

      const gl = this.gl;
      const shader = getProgramInfo();
      const uniforms = {};
      const effectMask = Object.prototype.hasOwnProperty.call(opts, "effectMask")
        ? opts.effectMask
        : drawable.enabledEffects;
      const effectBits = drawable.enabledEffects & effectMask;
      const effectInfo = ShaderManager.EFFECT_INFO;

      this._doExitDrawRegion();
      this._regionId = shader;
      gl.useProgram(shader.program);
      twgl.setBuffersAndAttributes(gl, shader, this._bufferInfo);

      Object.assign(
        uniforms,
        {
          u_projectionMatrix: projection,
          u_tintColor: tint.color,
          u_tintOpacity: tint.opacity,
          u_enableColor: effectBits & effectInfo.color.mask ? 1 : 0,
          u_enableBrightness: effectBits & effectInfo.brightness.mask ? 1 : 0,
        },
        drawable.skin.getUniforms(drawableScale),
        drawable.getUniforms(),
        opts.extraUniforms || {}
      );

      if (uniforms.u_skin) {
        twgl.setTextureParameters(gl, uniforms.u_skin, {
          minMag: drawable.skin.useNearest(drawableScale, drawable)
            ? gl.NEAREST
            : gl.LINEAR,
        });
      }

      twgl.setUniforms(shader, uniforms);
      twgl.drawBufferInfo(gl, this._bufferInfo, gl.TRIANGLES);
      this._regionId = null;
    };

    renderer._drawThese = function (drawables, drawMode, projection, opts = {}) {
      if (drawMode !== ShaderManager.DRAW_MODE.default) {
        originalDrawThese.call(this, drawables, drawMode, projection, opts);
        return;
      }

      let normalRun = [];
      const flushNormalRun = () => {
        if (normalRun.length) {
          originalDrawThese.call(this, normalRun, drawMode, projection, opts);
          normalRun = [];
        }
      };

      for (const drawableID of drawables) {
        const drawable = this._allDrawables[drawableID];
        const tint = drawable && drawable[TINT];
        if (tint && tint.opacity > 0) {
          flushNormalRun();
          drawTintedDrawable.call(this, drawableID, drawMode, projection, opts);
        } else {
          normalRun.push(drawableID);
        }
      }

      flushNormalRun();
    };
  };

  const initialize = () => {
    patchRenderer();
    patchClearEffects();
    patchDrawableTint();
    for (const target of runtime.targets) {
      if (target && target[TINT] && target.drawableID !== null) {
        setDrawableTint(target.drawableID, target[TINT]);
      }
    }
  };

  runtime.on("targetWasCreated", (target, originalTarget) => {
    initialize();
    if (target && originalTarget && originalTarget[TINT]) {
      applyTargetTint(target, {
        color: originalTarget[TINT].color.slice(),
        opacity: originalTarget[TINT].opacity,
      });
    }
  });
  runtime.on("PROJECT_LOADED", initialize);
  initialize();

  class SpriteTint {
    getInfo() {
      return {
        id: "spritetint",
        name: translate("spritetint.name", "Sprite Tint"),
        color1: "#ff6680",
        color2: "#e64d66",
        color3: "#cc334d",
        blocks: [
          {
            blockType: Scratch.BlockType.LABEL,
            text: translate("spritetint.stageSelected", "Stage selected: no blocks"),
            filter: [TargetType.STAGE],
          },
          {
            opcode: "setTint",
            blockType: Scratch.BlockType.COMMAND,
            text: translate(
              "spritetint.setTint",
              "set tint color [COLOR] opacity [OPACITY]"
            ),
            arguments: {
              COLOR: {
                type: Scratch.ArgumentType.COLOR,
                defaultValue: "#ff0000",
              },
              OPACITY: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 50,
              },
            },
            filter: [TargetType.SPRITE],
            extensions: ["colours_looks"],
          },
          {
            opcode: "clearTint",
            blockType: Scratch.BlockType.COMMAND,
            text: translate("spritetint.clearTint", "clear tint"),
            filter: [TargetType.SPRITE],
            extensions: ["colours_looks"],
          },
        ],
      };
    }

    setTint(args, util) {
      const target = util.target;
      if (!target || target.isStage) return;

      applyTargetTint(target, {
        color: hexToRgb(args.COLOR),
        opacity: clamp(Cast.toNumber(args.OPACITY), 0, 100) / 100,
      });
    }

    clearTint(args, util) {
      clearTargetTint(util.target);
    }
  }

  Scratch.extensions.register(new SpriteTint());
})(Scratch);

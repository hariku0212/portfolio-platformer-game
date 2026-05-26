/**
 * Canvas Platformer - game.js
 * HTML5 Canvas Adventure Game
 * Vanilla JavaScript (ES6+) | No external libraries | No external images
 *
 * Classes: Game, Player, Enemy, Coin, Platform, GoalObject,
 *          Particle, ParticleSystem, AudioManager, Camera, HUD, Stage
 */

'use strict';

// ============================================================
// 定数定義
// ============================================================

/** ゲーム状態定数 */
const GameState = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  STAGE_CLEAR: 'STAGE_CLEAR',
  GAME_OVER: 'GAME_OVER',
  GAME_COMPLETE: 'GAME_COMPLETE'
};

/** プレイヤー状態定数 */
const PlayerState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  JUMPING: 'JUMPING',
  FALLING: 'FALLING',
  DEAD: 'DEAD'
};

/** 物理演算定数 */
const PHYSICS = {
  GRAVITY: 0.5,
  JUMP_VELOCITY: -12,
  DOUBLE_JUMP_VELOCITY: -10,
  MAX_FALL_SPEED: 15,
  PLAYER_SPEED: 4,
  FRICTION: 0.85
};

/** 画面下落下判定Y座標 */
const FALL_DEATH_Y = 480;

/** 踏みつけ判定の余裕幅（px）: 敵の上端より4px以内を踏みつけとして判定（視覚的ヒットボックス調整） */
const STOMP_TOLERANCE = 4;

// ============================================================
// AudioManager クラス
// ============================================================

/**
 * @class AudioManager
 * Web Audio API を使った効果音管理クラス。
 * 外部音源ファイルは使用しない。
 */
class AudioManager {
  constructor() {
    this.enabled = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
      console.warn('AudioContext not supported:', e);
    }
  }

  /**
   * AudioContext を再開する（ユーザーインタラクション後に呼ぶ）
   */
  resume() {
    if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * 効果音を再生する
   * @param {string} type - サウンドタイプ (jump/coin/enemy_kill/damage/stage_clear/game_over)
   */
  play(type) {
    if (!this.enabled) return;
    try {
      this._playSound(type);
    } catch (e) {
      console.warn('Sound play failed:', e);
    }
  }

  /**
   * @private
   * @param {string} type
   */
  _playSound(type) {
    if (!this.ctx) return;
    const sounds = {
      jump:        { type: 'sine',     freq: [300, 600],         duration: 0.15 },
      coin:        { type: 'triangle', freq: [800, 1200],        duration: 0.1  },
      enemy_kill:  { type: 'square',   freq: [400, 200],         duration: 0.2  },
      damage:      { type: 'sawtooth', freq: [150, 80],          duration: 0.3  },
      stage_clear: { type: 'sine',     freq: [400, 500, 600, 800], duration: 0.6 },
      game_over:   { type: 'sine',     freq: [400, 300, 200, 150], duration: 0.8 },
    };

    const def = sounds[type];
    if (!def) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = def.type;
    osc.frequency.setValueAtTime(def.freq[0], this.ctx.currentTime);

    const stepDuration = def.duration / def.freq.length;
    def.freq.forEach((f, i) => {
      osc.frequency.setValueAtTime(f, this.ctx.currentTime + i * stepDuration);
    });

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + def.duration);

    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + def.duration + 0.01);
  }
}

// ============================================================
// Particle クラス
// ============================================================

/**
 * @class Particle
 * 単一パーティクルの更新・描画を担当する。
 */
class Particle {
  /**
   * @param {number} x - ワールド座標X
   * @param {number} y - ワールド座標Y
   * @param {number} vx - X速度
   * @param {number} vy - Y速度
   * @param {string} color - 色
   * @param {number} size - 初期サイズ（px）
   * @param {number} lifetime - 寿命（フレーム数）
   */
  constructor(x, y, vx, vy, color, size, lifetime) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.lifetime = lifetime;
    this.age = 0;
    this.alive = true;
  }

  /** 毎フレーム更新 */
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.2;   // 軽い重力
    this.vx *= 0.98;  // 空気抵抗
    this.age++;
    if (this.age >= this.lifetime) this.alive = false;
  }

  /**
   * Canvasに描画する
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  draw(ctx, cameraX) {
    const alpha = 1 - this.age / this.lifetime;
    const currentSize = this.size * alpha;
    if (currentSize <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(
      this.x - cameraX - currentSize / 2,
      this.y - currentSize / 2,
      currentSize,
      currentSize
    );
    ctx.globalAlpha = 1.0;
  }
}

// ============================================================
// ParticleSystem クラス
// ============================================================

/**
 * @class ParticleSystem
 * パーティクルの一括管理クラス。
 * emit() でエフェクト種別ごとのパーティクルを生成する。
 */
class ParticleSystem {
  constructor() {
    /** @type {Particle[]} */
    this.particles = [];
  }

  /**
   * エフェクトを発生させる
   * @param {string} type - 'coin' | 'enemy_death'
   * @param {number} x - ワールド座標X
   * @param {number} y - ワールド座標Y
   */
  emit(type, x, y) {
    if (type === 'coin') {
      const colors = ['#FFD700', '#FFA500', '#FFFF00'];
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 / 8) * i;
        const speed = 2 + Math.random() * 2;
        this.particles.push(new Particle(
          x, y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 1,
          colors[Math.floor(Math.random() * colors.length)],
          4 + Math.random() * 3,
          25 + Math.floor(Math.random() * 11)
        ));
      }
    } else if (type === 'enemy_death') {
      const colors = ['#E74C3C', '#FF6B35', '#FF8C00'];
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 / 12) * i;
        const speed = 3 + Math.random() * 3;
        this.particles.push(new Particle(
          x, y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          colors[Math.floor(Math.random() * colors.length)],
          5 + Math.random() * 4,
          30 + Math.floor(Math.random() * 16)
        ));
      }
    }

    // パーティクル上限 200
    if (this.particles.length > 200) {
      this.particles.splice(0, this.particles.length - 200);
    }
  }

  /** 毎フレーム更新 */
  update() {
    this.particles = this.particles.filter(p => p.alive);
    this.particles.forEach(p => p.update());
  }

  /**
   * 全パーティクルを描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  draw(ctx, cameraX) {
    this.particles.forEach(p => p.draw(ctx, cameraX));
  }
}

// ============================================================
// Platform クラス
// ============================================================

/**
 * @class Platform
 * 固定・移動プラットフォーム。
 */
class Platform {
  /**
   * @param {Object} config - プラットフォーム設定
   * @param {number} config.x
   * @param {number} config.y
   * @param {number} config.width
   * @param {number} config.height
   * @param {string} config.type - 'fixed' | 'moving'
   * @param {number} [config.speed]
   * @param {number} [config.startX]
   * @param {number} [config.endX]
   */
  constructor(config) {
    this.x = config.x;
    this.y = config.y;
    this.width = config.width;
    this.height = config.height || 20;
    this.type = config.type || 'fixed';

    if (this.type === 'moving') {
      this.speed = config.speed || 1.5;
      this.startX = config.startX !== undefined ? config.startX : this.x;
      this.endX = config.endX !== undefined ? config.endX : this.x + 150;
      this.direction = 1;
      this.color = '#9B59B6';
      this.topColor = '#8E44AD';
    } else {
      this.color = config.color || '#8B4513';
      this.topColor = config.topColor || '#228B22';
    }
  }

  /** バウンディングボックスを返す */
  getBounds() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /** 毎フレーム更新（移動プラットフォームのみ有効） */
  update() {
    if (this.type !== 'moving') return;
    this.x += this.speed * this.direction;
    if (this.x >= this.endX) {
      this.x = this.endX;
      this.direction = -1;
    }
    if (this.x <= this.startX) {
      this.x = this.startX;
      this.direction = 1;
    }
  }

  /**
   * Canvasに描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  draw(ctx, cameraX) {
    const drawX = this.x - cameraX;
    if (drawX + this.width < 0 || drawX > 800) return;

    ctx.fillStyle = this.color;
    ctx.fillRect(drawX, this.y, this.width, this.height);

    ctx.fillStyle = this.topColor;
    ctx.fillRect(drawX, this.y, this.width, 5);

    if (this.type === 'moving') {
      ctx.fillStyle = 'white';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↔', drawX + this.width / 2, this.y + this.height / 2 + 3);
    }
  }
}

// ============================================================
// Coin クラス
// ============================================================

/**
 * @class Coin
 * コインの配置・アニメーション・取得判定を担う。
 */
class Coin {
  /**
   * @param {number} x - ワールド座標X（中心）
   * @param {number} y - ワールド座標Y（中心）
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.collected = false;
    this.floatSpeed = 0.05;
    this.phase = Math.random() * Math.PI * 2;
    // AABB判定用
    this.width = this.radius * 2;
    this.height = this.radius * 2;
  }

  /** バウンディングボックス（AABB判定用） */
  getBounds() {
    return {
      x: this.x - this.radius,
      y: this.y - this.radius,
      width: this.radius * 2,
      height: this.radius * 2
    };
  }

  /**
   * Canvasに描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   * @param {number} frameCount
   */
  draw(ctx, cameraX, frameCount) {
    if (this.collected) return;
    const drawX = this.x - cameraX;
    if (drawX < -20 || drawX > 820) return;

    const floatY = this.y + Math.sin(frameCount * this.floatSpeed + this.phase) * 3;

    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(drawX, floatY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#FF8C00';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', drawX, floatY);
  }
}

// ============================================================
// Enemy クラス
// ============================================================

/**
 * @class Enemy
 * パトロールAI・踏みつけ判定・撃破アニメーションを担当。
 */
class Enemy {
  /**
   * @param {number} x - ワールド座標X
   * @param {number} y - ワールド座標Y
   * @param {number} startX - パトロール開始X
   * @param {Platform[]} platforms - 参照するプラットフォーム配列
   */
  constructor(x, y, startX, platforms) {
    this.x = x;
    this.y = y;
    this.width = 32;
    this.height = 32;
    this.alive = true;
    this.crushed = false;
    this.crushTimer = 0;
    this.patrolDistance = 200;
    this.patrolSpeed = 1.5;
    this.startX = startX !== undefined ? startX : x;
    this.direction = 1;
    this.platforms = platforms;
  }

  /** バウンディングボックス */
  getBounds() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /** 毎フレーム更新 */
  update() {
    if (!this.alive) {
      if (this.crushed) {
        this.crushTimer--;
        if (this.crushTimer <= 0) {
          this.crushed = false;
        }
      }
      return;
    }

    this.x += this.patrolSpeed * this.direction;

    if (this.x > this.startX + this.patrolDistance) {
      this.x = this.startX + this.patrolDistance;
      this.direction = -1;
    }
    if (this.x < this.startX) {
      this.x = this.startX;
      this.direction = 1;
    }

    this.checkPlatformEdge();
  }

  /**
   * プラットフォームの端で反転する
   * @private
   */
  checkPlatformEdge() {
    const checkX = this.x + (this.direction === 1 ? this.width + 1 : -1);
    const checkY = this.y + this.height + 1;
    const onEdge = !this.platforms.some(p =>
      checkX >= p.x && checkX <= p.x + p.width &&
      checkY >= p.y && checkY <= p.y + p.height
    );
    if (onEdge) {
      this.direction *= -1;
    }
  }

  /**
   * 敵を撃破状態にする
   */
  crush() {
    this.alive = false;
    this.crushed = true;
    this.crushTimer = 30;
  }

  /**
   * Canvasに描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  draw(ctx, cameraX) {
    if (!this.alive && !this.crushed) return;

    const drawX = this.x - cameraX;
    if (drawX + this.width < -10 || drawX > 810) return;

    const drawHeight = this.crushed ? this.height * (this.crushTimer / 30) : this.height;
    const drawY = this.crushed ? this.y + (this.height - drawHeight) : this.y;

    ctx.fillStyle = '#E74C3C';
    ctx.fillRect(drawX, drawY, this.width, drawHeight);

    if (!this.crushed && drawHeight > 5) {
      // 左目
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(drawX + 8, drawY + 10, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(drawX + 9, drawY + 10, 2, 0, Math.PI * 2);
      ctx.fill();
      // 右目
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(drawX + 22, drawY + 10, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(drawX + 23, drawY + 10, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ============================================================
// GoalObject クラス
// ============================================================

/**
 * @class GoalObject
 * ステージゴール（旗ポール）。
 */
class GoalObject {
  /**
   * @param {number} x - ワールド座標X
   * @param {number} y - ワールド座標Y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 40;
    this.height = 60;
    this.color = '#00FF00';
    this.animTimer = 0;
  }

  /** バウンディングボックス */
  getBounds() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /** 毎フレーム更新 */
  update() {
    this.animTimer++;
  }

  /**
   * Canvasに描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  draw(ctx, cameraX) {
    const drawX = this.x - cameraX;
    if (drawX + this.width < -10 || drawX > 810) return;

    // ポール
    ctx.fillStyle = '#888888';
    ctx.fillRect(drawX + 18, this.y, 4, this.height);

    // 旗（アニメーション）
    const wave = Math.sin(this.animTimer * 0.1) * 4;
    ctx.fillStyle = '#00FF00';
    ctx.beginPath();
    ctx.moveTo(drawX + 22, this.y + 2);
    ctx.lineTo(drawX + 22 + 18, this.y + 8 + wave);
    ctx.lineTo(drawX + 22, this.y + 18);
    ctx.closePath();
    ctx.fill();

    // 台座
    ctx.fillStyle = '#555555';
    ctx.fillRect(drawX + 10, this.y + this.height - 6, 20, 6);

    // 輝き（点滅）
    if (Math.floor(this.animTimer / 15) % 2 === 0) {
      ctx.strokeStyle = '#FFFF00';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, this.y, this.width, this.height);
    }
  }
}

// ============================================================
// Player クラス
// ============================================================

/**
 * @class Player
 * プレイヤーの状態・物理演算・衝突・描画を担当。
 */
class Player {
  constructor() {
    this.x = 50;
    this.y = 350;
    this.width = 32;
    this.height = 40;
    this.vx = 0;
    this.vy = 0;
    this.lives = 3;
    this.score = 0;
    this.onGround = false;
    this.jumpCount = 0;
    this.invincible = false;
    this.invincibleTimer = 0;
    this.facing = 1;
    this.state = PlayerState.IDLE;
    /** @type {Platform|null} */
    this.standingPlatform = null;
  }

  /** バウンディングボックス */
  getBounds() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /**
   * ステージの初期位置にリセットする
   * @param {number} x
   * @param {number} y
   */
  resetPosition(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.jumpCount = 0;
    this.standingPlatform = null;
  }

  /**
   * ステージ開始時にフル初期化する
   * @param {number} x
   * @param {number} y
   */
  resetFull(x, y) {
    this.resetPosition(x, y);
    this.lives = 3;
    this.score = 0;
    this.invincible = false;
    this.invincibleTimer = 0;
    this.facing = 1;
    this.state = PlayerState.IDLE;
  }

  /**
   * 物理演算・衝突検出を行う
   * @param {Platform[]} platforms
   * @param {number} stageWidth
   */
  update(platforms, stageWidth) {
    // 無敵タイマー処理
    if (this.invincible) {
      this.invincibleTimer--;
      if (this.invincibleTimer <= 0) {
        this.invincible = false;
        this.invincibleTimer = 0;
      }
    }

    // 重力
    this.vy += PHYSICS.GRAVITY;
    if (this.vy > PHYSICS.MAX_FALL_SPEED) this.vy = PHYSICS.MAX_FALL_SPEED;

    // onGround リセット
    this.onGround = false;
    this.standingPlatform = null;

    // ===== 縦方向の衝突解決 =====
    const prevY = this.y;
    this.y += this.vy;

    for (const platform of platforms) {
      if (!isOverlapping(this.getBounds(), platform.getBounds())) continue;

      const prevBottom = prevY + this.height;
      const prevTop = prevY;
      const platTop = platform.y;
      const platBottom = platform.y + platform.height;

      if (prevBottom <= platTop + 1) {
        // 上から乗った
        this.y = platTop - this.height;
        this.vy = 0;
        this.onGround = true;
        this.standingPlatform = platform;
      } else if (prevTop >= platBottom - 1) {
        // 下から当たった
        this.y = platBottom;
        this.vy = 0;
      }
      // 横方向は後で解決
    }

    // 着地したら jumpCount リセット
    if (this.onGround) {
      this.jumpCount = 0;
    }

    // 移動プラットフォームに乗っている場合
    if (this.onGround && this.standingPlatform && this.standingPlatform.type === 'moving') {
      this.x += this.standingPlatform.speed * this.standingPlatform.direction;
    }

    // ===== 横方向の衝突解決 =====
    const prevX = this.x;
    this.x += this.vx;

    for (const platform of platforms) {
      if (!isOverlapping(this.getBounds(), platform.getBounds())) continue;

      const prevRight = prevX + this.width;
      const prevLeft = prevX;
      const platLeft = platform.x;
      const platRight = platform.x + platform.width;

      if (prevRight <= platLeft + 1) {
        // 右壁
        this.x = platLeft - this.width;
        this.vx = 0;
      } else if (prevLeft >= platRight - 1) {
        // 左壁
        this.x = platRight;
        this.vx = 0;
      }
    }

    // ステージ左端クランプ
    if (this.x < 0) {
      this.x = 0;
      this.vx = 0;
    }

    // ステージ右端クランプ
    if (this.x + this.width > stageWidth) {
      this.x = stageWidth - this.width;
      this.vx = 0;
    }

    // 状態更新
    this._updateState();
  }

  /**
   * @private
   * プレイヤー状態を更新する
   */
  _updateState() {
    if (this.state === PlayerState.DEAD) return;
    if (this.onGround) {
      this.state = Math.abs(this.vx) > 0.1 ? PlayerState.RUNNING : PlayerState.IDLE;
    } else {
      this.state = this.vy < 0 ? PlayerState.JUMPING : PlayerState.FALLING;
    }
  }

  /**
   * Canvasに描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   * @param {number} frameCount
   */
  draw(ctx, cameraX, frameCount) {
    // 無敵点滅
    if (this.invincible && Math.floor(this.invincibleTimer / 5) % 2 === 0) return;

    const drawX = this.x - cameraX;
    const drawY = this.y;

    // 体（青い矩形）
    ctx.fillStyle = '#4A90D9';
    ctx.fillRect(drawX, drawY, this.width, this.height);

    // 顔ハイライト
    ctx.fillStyle = '#5BA3F0';
    ctx.fillRect(drawX + 4, drawY + 4, this.width - 8, 16);

    // 向きに応じた目オフセット
    const eyeOffsetX = this.facing === 1 ? 0 : 4;

    // 左目
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(drawX + 8 + eyeOffsetX, drawY + 12, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(drawX + 9 + eyeOffsetX, drawY + 12, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 右目
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(drawX + 20 + eyeOffsetX, drawY + 12, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(drawX + 21 + eyeOffsetX, drawY + 12, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 足（走行アニメーション）
    if (this.state === PlayerState.RUNNING) {
      const legOffset = Math.sin(frameCount * 0.25) * 5;
      ctx.fillStyle = '#3A7BC8';
      ctx.fillRect(drawX + 4, drawY + this.height - 10, 10, 10 + legOffset);
      ctx.fillRect(drawX + 18, drawY + this.height - 10, 10, 10 - legOffset);
    }

    // DEAD 状態は×マーク
    if (this.state === PlayerState.DEAD) {
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(drawX + 4, drawY + 4);
      ctx.lineTo(drawX + this.width - 4, drawY + this.height - 4);
      ctx.moveTo(drawX + this.width - 4, drawY + 4);
      ctx.lineTo(drawX + 4, drawY + this.height - 4);
      ctx.stroke();
    }
  }
}

// ============================================================
// Camera クラス
// ============================================================

/**
 * @class Camera
 * カメラ（スクロール）制御。縦スクロールなし。
 */
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }

  /**
   * プレイヤーを追従してカメラを更新
   * @param {number} playerX - プレイヤーのワールド座標X
   * @param {number} stageWidth - ステージ幅
   */
  update(playerX, stageWidth) {
    const targetX = playerX - 800 / 3;
    this.x = Math.max(0, Math.min(targetX, stageWidth - 800));
  }
}

// ============================================================
// HUD クラス
// ============================================================

/**
 * @class HUD
 * スコア・ライフ・タイマー・コインカウンターをCanvas上に描画する。
 */
class HUD {
  /**
   * HUDを描画する
   * @param {CanvasRenderingContext2D} ctx
   * @param {Player} player
   * @param {number} stageIndex - 0-based
   * @param {number} elapsedSeconds
   * @param {number} coinsCollected
   * @param {number} totalCoins
   */
  draw(ctx, player, stageIndex, elapsedSeconds, coinsCollected, totalCoins) {
    // 背景帯
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, 800, 55);

    // スコアラベル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('SCORE', 10, 8);

    // スコア値
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(String(player.score).padStart(6, '0'), 10, 28);

    // ライフラベル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('LIVES', 150, 8);

    // ライフ（赤矩形）
    ctx.fillStyle = '#FF4444';
    for (let i = 0; i < player.lives; i++) {
      ctx.fillRect(150 + i * 18, 28, 14, 14);
    }

    // ステージラベル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('STAGE', 330, 8);

    // ステージ値
    ctx.fillStyle = '#00FF88';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(`${stageIndex + 1} / 3`, 330, 28);

    // タイマーラベル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('TIME', 500, 8);

    // タイマー値
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(`${elapsedSeconds.toFixed(1)} s`, 500, 28);

    // コインカウンター
    ctx.fillStyle = '#FFD700';
    ctx.font = '16px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`$ ${coinsCollected} / ${totalCoins}`, 790, 20);

    // テキストアラインを元に戻す
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// ============================================================
// Stage クラス
// ============================================================

/**
 * @class Stage
 * ステージデータを保持・生成するファクトリクラス。
 */
class Stage {
  /**
   * 指定インデックスのステージデータを生成して返す
   * @param {number} index - 0: Stage1, 1: Stage2, 2: Stage3
   * @returns {Object} ステージオブジェクト
   */
  static create(index) {
    const stages = [Stage._stage1, Stage._stage2, Stage._stage3];
    return stages[index]();
  }

  /** @private Stage1 データ生成 */
  static _stage1() {
    const platforms = [
      new Platform({ x: 0,    y: 410, width: 2400, height: 40, type: 'fixed', color: '#5D4037', topColor: '#4CAF50' }),
      new Platform({ x: 200,  y: 330, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 400,  y: 270, width: 150,  height: 20, type: 'fixed' }),
      new Platform({ x: 620,  y: 330, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 800,  y: 250, width: 200,  height: 20, type: 'fixed' }),
      new Platform({ x: 1050, y: 310, width: 120,  height: 20, type: 'moving', speed: 1.5, startX: 1050, endX: 1200 }),
      new Platform({ x: 1300, y: 240, width: 150,  height: 20, type: 'fixed' }),
      new Platform({ x: 1500, y: 300, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 1700, y: 220, width: 180,  height: 20, type: 'fixed' }),
      new Platform({ x: 1950, y: 280, width: 140,  height: 20, type: 'fixed' }),
      new Platform({ x: 2100, y: 340, width: 100,  height: 20, type: 'fixed' }),
    ];

    const enemies = [
      new Enemy(820,  218, 820,  platforms),
      new Enemy(1310, 208, 1310, platforms),
    ];

    const coins = [
      new Coin(260,  300),
      new Coin(470,  240),
      new Coin(670,  300),
      new Coin(900,  220),
      new Coin(1000, 220),
      new Coin(1125, 280),
      new Coin(1380, 210),
      new Coin(1750, 190),
    ];

    const goal = new GoalObject(2120, 308);

    return {
      index: 0,
      name: 'はじめの一歩',
      worldWidth: 2400,
      platforms,
      enemies,
      coins,
      goal,
      respawnX: 50,
      respawnY: 350,
    };
  }

  /** @private Stage2 データ生成 */
  static _stage2() {
    const platforms = [
      new Platform({ x: 0,    y: 410, width: 3200, height: 40, type: 'fixed', color: '#5D4037', topColor: '#4CAF50' }),
      new Platform({ x: 180,  y: 320, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 350,  y: 260, width: 120,  height: 20, type: 'moving', speed: 2.0, startX: 350, endX: 520 }),
      new Platform({ x: 600,  y: 300, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 750,  y: 230, width: 140,  height: 20, type: 'fixed' }),
      new Platform({ x: 950,  y: 170, width: 100,  height: 20, type: 'moving', speed: 1.5, startX: 950, endX: 1100 }),
      new Platform({ x: 1150, y: 260, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 1350, y: 190, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 1550, y: 140, width: 160,  height: 20, type: 'moving', speed: 2.5, startX: 1550, endX: 1750 }),
      new Platform({ x: 1850, y: 200, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 2050, y: 280, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 2250, y: 200, width: 140,  height: 20, type: 'moving', speed: 2.0, startX: 2250, endX: 2430 }),
      new Platform({ x: 2500, y: 150, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 2700, y: 220, width: 160,  height: 20, type: 'fixed' }),
      new Platform({ x: 2950, y: 300, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 3050, y: 360, width: 100,  height: 20, type: 'fixed' }),
    ];

    const enemies = [
      new Enemy(770,  198, 770,  platforms),
      new Enemy(1170, 228, 1170, platforms),
      new Enemy(2270, 168, 2270, platforms),
      new Enemy(2710, 188, 2710, platforms),
    ];

    const coins = [
      new Coin(230,  290),
      new Coin(410,  230),
      new Coin(640,  270),
      new Coin(820,  200),
      new Coin(1025, 140),
      new Coin(1210, 230),
      new Coin(1400, 160),
      new Coin(1650, 110),
      new Coin(1920, 170),
      new Coin(2100, 250),
      new Coin(2560, 120),
      new Coin(2760, 190),
    ];

    const goal = new GoalObject(3070, 328);

    return {
      index: 1,
      name: '空への挑戦',
      worldWidth: 3200,
      platforms,
      enemies,
      coins,
      goal,
      respawnX: 50,
      respawnY: 350,
    };
  }

  /** @private Stage3 データ生成 */
  static _stage3() {
    const platforms = [
      new Platform({ x: 0,    y: 410, width: 4000, height: 40, type: 'fixed', color: '#5D4037', topColor: '#4CAF50' }),
      new Platform({ x: 150,  y: 340, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 300,  y: 280, width: 80,   height: 20, type: 'moving', speed: 2.5, startX: 300, endX: 430 }),
      new Platform({ x: 500,  y: 220, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 650,  y: 160, width: 80,   height: 20, type: 'moving', speed: 3.0, startX: 650, endX: 800 }),
      new Platform({ x: 900,  y: 300, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 1050, y: 230, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 1200, y: 160, width: 80,   height: 20, type: 'moving', speed: 2.5, startX: 1200, endX: 1340 }),
      new Platform({ x: 1450, y: 240, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 1650, y: 170, width: 80,   height: 20, type: 'moving', speed: 3.0, startX: 1650, endX: 1790 }),
      new Platform({ x: 1900, y: 280, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 2100, y: 200, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 2280, y: 130, width: 100,  height: 20, type: 'moving', speed: 3.5, startX: 2280, endX: 2450 }),
      new Platform({ x: 2550, y: 210, width: 120,  height: 20, type: 'fixed' }),
      new Platform({ x: 2750, y: 150, width: 80,   height: 20, type: 'moving', speed: 2.5, startX: 2750, endX: 2880 }),
      new Platform({ x: 2980, y: 240, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 3180, y: 170, width: 80,   height: 20, type: 'fixed' }),
      new Platform({ x: 3370, y: 110, width: 120,  height: 20, type: 'moving', speed: 3.0, startX: 3370, endX: 3530 }),
      new Platform({ x: 3600, y: 200, width: 100,  height: 20, type: 'fixed' }),
      new Platform({ x: 3800, y: 300, width: 140,  height: 20, type: 'fixed' }),
    ];

    const enemies = [
      new Enemy(920,  268, 920,  platforms),
      new Enemy(1070, 198, 1070, platforms),
      new Enemy(1470, 208, 1470, platforms),
      new Enemy(2120, 168, 2120, platforms),
      new Enemy(2570, 178, 2570, platforms),
      new Enemy(3000, 208, 3000, platforms),
    ];

    const coins = [
      new Coin(190,  310),
      new Coin(365,  250),
      new Coin(540,  190),
      new Coin(725,  130),
      new Coin(950,  270),
      new Coin(1090, 200),
      new Coin(1265, 130),
      new Coin(1510, 210),
      new Coin(1725, 140),
      new Coin(1950, 250),
      new Coin(2140, 170),
      new Coin(2365, 100),
      new Coin(2610, 180),
      new Coin(2815, 120),
      new Coin(3220, 140),
      new Coin(3450, 80),
    ];

    const goal = new GoalObject(3820, 268);

    return {
      index: 2,
      name: '頂上決戦',
      worldWidth: 4000,
      platforms,
      enemies,
      coins,
      goal,
      respawnX: 50,
      respawnY: 350,
    };
  }
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * AABB 重複判定
 * @param {{x:number,y:number,width:number,height:number}} a
 * @param {{x:number,y:number,width:number,height:number}} b
 * @returns {boolean}
 */
function isOverlapping(a, b) {
  return a.x < b.x + b.width &&
         a.x + a.width > b.x &&
         a.y < b.y + b.height &&
         a.y + a.height > b.y;
}

/**
 * ボタン矩形を描画するヘルパー
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - 中心X
 * @param {number} cy - ボタン上端Y
 * @param {number} w
 * @param {number} h
 * @param {string} color
 * @param {string} text
 * @param {string} textColor
 * @param {string} font
 */
function drawButton(ctx, cx, cy, w, h, color, text, textColor, font) {
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, cy, w, h);
  ctx.fillStyle = textColor;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + h / 2);
}

// ============================================================
// Game クラス（メインループ・状態管理）
// ============================================================

/**
 * @class Game
 * ゲーム全体のメインループと状態管理を担う。
 */
class Game {
  constructor() {
    /** @type {HTMLCanvasElement} */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = null;

    this.state = GameState.MENU;

    /** @type {Player} */
    this.player = new Player();
    /** @type {Camera} */
    this.camera = new Camera();
    /** @type {HUD} */
    this.hud = new HUD();
    /** @type {AudioManager} */
    this.audio = new AudioManager();
    /** @type {ParticleSystem} */
    this.particles = new ParticleSystem();

    /** @type {Object|null} 現在のステージデータ */
    this.currentStage = null;
    this.currentStageIndex = 0;

    // タイマー
    this.frameCount = 0;
    this.stageStartTime = 0;   // Date.now() ベースのタイマー開始時刻（ms）
    this.totalElapsedSeconds = 0;
    this.stageClearTime = 0;

    // 入力状態
    this.keys = {};
    this.jumpPressed = false;
    this.touchButtons = { left: false, right: false, jump: false };
    this.prevTouchJump = false;

    // タッチデバイス判定
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // ループID
    this._rafId = null;
  }

  /**
   * ゲームを初期化してループを開始する
   */
  init() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');

    this._setupInput();
    this._startLoop();
  }

  // ============================================================
  // 入力設定
  // ============================================================

  /** @private 入力イベントを設定する */
  _setupInput() {
    // キーボード
    document.addEventListener('keydown', (e) => {
      this.audio.resume();
      this.keys[e.key] = true;

      // ジャンプキー（リピートは無視）
      if (!e.repeat && (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ')) {
        this.jumpPressed = true;
      }

      // メニュー遷移
      if (e.key === ' ' || e.key === 'Enter') {
        this._handleMenuKey();
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });

    // マウスクリック（メニュー操作）
    this.canvas.addEventListener('click', (e) => {
      this.audio.resume();
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (800 / rect.width);
      const y = (e.clientY - rect.top) * (450 / rect.height);
      this._handleMenuInput(x, y);
    });

    // タッチ操作
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.audio.resume();

      // メニュー状態ではタップ座標でボタン判定
      if (this.state !== GameState.PLAYING) {
        const touch = e.changedTouches[0];
        const rect = this.canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) * (800 / rect.width);
        const y = (touch.clientY - rect.top) * (450 / rect.height);
        this._handleMenuInput(x, y);
      }

      // ゲームプレイ中のタッチボタン処理
      Array.from(e.changedTouches).forEach(touch => {
        const btn = this._getTouchButton(touch.clientX, touch.clientY);
        if (btn === 'jump' && !this.prevTouchJump) {
          this.jumpPressed = true;
        }
        if (btn) this.touchButtons[btn] = true;
      });
      this.prevTouchJump = this.touchButtons.jump;
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.touchButtons.left = false;
      this.touchButtons.right = false;
      this.touchButtons.jump = false;
      Array.from(e.touches).forEach(touch => {
        const btn = this._getTouchButton(touch.clientX, touch.clientY);
        if (btn) this.touchButtons[btn] = true;
      });
      this.prevTouchJump = this.touchButtons.jump;
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const wasJump = this.touchButtons.jump;
      this.touchButtons.left = false;
      this.touchButtons.right = false;
      this.touchButtons.jump = false;
      Array.from(e.touches).forEach(touch => {
        const btn = this._getTouchButton(touch.clientX, touch.clientY);
        if (btn) this.touchButtons[btn] = true;
      });
      if (this.touchButtons.jump && !wasJump) {
        this.jumpPressed = true;
      }
      this.prevTouchJump = this.touchButtons.jump;
    }, { passive: false });
  }

  /**
   * タッチ座標からボタン種別を返す
   * @private
   * @param {number} clientX
   * @param {number} clientY
   * @returns {string|null}
   */
  _getTouchButton(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = 800 / rect.width;
    const scaleY = 450 / rect.height;
    const lx = (clientX - rect.left) * scaleX;
    const ly = (clientY - rect.top) * scaleY;

    if (Math.hypot(lx - 60, ly - 410) <= 35) return 'left';
    if (Math.hypot(lx - 145, ly - 410) <= 35) return 'right';
    if (Math.hypot(lx - 740, ly - 410) <= 40) return 'jump';
    return null;
  }

  /**
   * メニュー状態でのキー入力処理
   * @private
   */
  _handleMenuKey() {
    if (this.state === GameState.MENU) {
      this._startGame();
    } else if (this.state === GameState.STAGE_CLEAR) {
      this._onNextStage();
    } else if (this.state === GameState.GAME_OVER) {
      this._retryGame();
    } else if (this.state === GameState.GAME_COMPLETE) {
      this.state = GameState.MENU;
    }
  }

  /**
   * メニュー画面のボタンクリック処理
   * @private
   * @param {number} x - Canvas論理座標X
   * @param {number} y - Canvas論理座標Y
   */
  _handleMenuInput(x, y) {
    const cx = 400;
    if (this.state === GameState.MENU) {
      // START GAME ボタン: y=290〜340
      if (x >= cx - 100 && x <= cx + 100 && y >= 290 && y <= 340) {
        this._startGame();
      }
    } else if (this.state === GameState.STAGE_CLEAR) {
      // NEXT / FINISH ボタン: y=290〜340
      if (x >= cx - 100 && x <= cx + 100 && y >= 290 && y <= 340) {
        this._onNextStage();
      }
    } else if (this.state === GameState.GAME_OVER) {
      // RETRY ボタン: y=270〜320
      if (x >= cx - 100 && x <= cx + 100 && y >= 270 && y <= 320) {
        this._retryGame();
      }
    } else if (this.state === GameState.GAME_COMPLETE) {
      // BACK TO MENU ボタン: y=310〜360
      if (x >= cx - 110 && x <= cx + 110 && y >= 310 && y <= 360) {
        this.state = GameState.MENU;
      }
    }
  }

  // ============================================================
  // ゲーム遷移
  // ============================================================

  /** @private ゲームを開始する（ステージ1から） */
  _startGame() {
    this.currentStageIndex = 0;
    this.totalElapsedSeconds = 0;
    this.player.resetFull(50, 350);
    this._loadStage(0);
    this.state = GameState.PLAYING;
    this._startLoop(); // MENU停止後のループ再開
  }

  /**
   * @private ステージをロードする
   * @param {number} index
   */
  _loadStage(index) {
    this.currentStage = Stage.create(index);
    this.stageStartTime = Date.now(); // ステージ開始時刻を記録（MENUやポーズ中の時間を除外するため）
    this.particles = new ParticleSystem();
    this.camera.x = 0;
    this.player.resetPosition(
      this.currentStage.respawnX,
      this.currentStage.respawnY
    );
  }

  /** @private リトライ処理 */
  _retryGame() {
    this.currentStageIndex = 0;
    this.totalElapsedSeconds = 0;
    this.player.resetFull(50, 350);
    this._loadStage(0);
    this.state = GameState.PLAYING;
  }

  /** @private 次ステージへ */
  _onNextStage() {
    if (this.currentStageIndex < 2) {
      this.currentStageIndex++;
      this._loadStage(this.currentStageIndex);
      this.state = GameState.PLAYING;
    } else {
      this.state = GameState.GAME_COMPLETE;
    }
  }

  // ============================================================
  // 入力ヘルパー
  // ============================================================

  /** @returns {boolean} 左入力 */
  _isLeft() { return !!(this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A'] || this.touchButtons.left); }
  /** @returns {boolean} 右入力 */
  _isRight() { return !!(this.keys['ArrowRight'] || this.keys['d'] || this.keys['D'] || this.touchButtons.right); }

  // ============================================================
  // ゲームループ
  // ============================================================

  /** @private メインゲームループ */
  _loop() {
    this._update();
    this._draw();
    // MENUに戻ったらrAFを止める（描画は1フレーム済み）。再開は _startLoop() で行う
    if (this.state === GameState.MENU) {
      this._rafId = null;
      return;
    }
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  /** @private rAFループを（再）起動する。多重起動防止付き */
  _startLoop() {
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  /** @private 毎フレームの更新処理 */
  _update() {
    this.frameCount++;

    if (this.state !== GameState.PLAYING) return;
    if (this.player.state === PlayerState.DEAD) return;

    const stage = this.currentStage;
    const player = this.player;
    const elapsed = (Date.now() - this.stageStartTime) / 1000; // Date.now()で実経過時間を計測（MENU待機中の時間を含まない）

    // ===== 1. 入力処理 =====
    if (this._isLeft() && this._isRight()) {
      player.vx *= PHYSICS.FRICTION;
    } else if (this._isLeft()) {
      player.vx = -PHYSICS.PLAYER_SPEED;
      player.facing = -1;
    } else if (this._isRight()) {
      player.vx = PHYSICS.PLAYER_SPEED;
      player.facing = 1;
    } else {
      if (player.onGround) player.vx *= PHYSICS.FRICTION;
    }

    // ===== 2. ジャンプ処理 =====
    if (this.jumpPressed) {
      if (player.jumpCount === 0 && player.onGround) {
        player.vy = PHYSICS.JUMP_VELOCITY;
        player.jumpCount = 1;
        player.onGround = false;
        this.audio.play('jump');
      } else if (player.jumpCount === 1) {
        player.vy = PHYSICS.DOUBLE_JUMP_VELOCITY;
        player.jumpCount = 2;
        this.audio.play('jump');
      }
      this.jumpPressed = false;
    }

    // ===== 3. 移動プラットフォーム更新 =====
    stage.platforms.forEach(p => p.update());

    // ===== 4. プレイヤー物理更新 =====
    player.update(stage.platforms, stage.worldWidth);

    // ===== 5. 画面外落下判定 =====
    if (player.y > FALL_DEATH_Y && !player.invincible) {
      player.lives -= 1;
      if (player.lives <= 0) {
        player.lives = 0;
        player.state = PlayerState.DEAD;
        this.audio.play('game_over');
        setTimeout(() => { this.state = GameState.GAME_OVER; }, 1000);
      } else {
        player.x = stage.respawnX;
        player.y = stage.respawnY;
        player.vx = 0;
        player.vy = 0;
        player.invincible = true;
        player.invincibleTimer = 120;
        this.audio.play('damage');
      }
    }

    // ===== 6. 敵更新 =====
    stage.enemies.forEach(e => e.update());

    // ===== 7. 敵との衝突 =====
    if (player.state !== PlayerState.DEAD) {
      for (const enemy of stage.enemies) {
        if (!enemy.alive) continue;
        if (!isOverlapping(player.getBounds(), enemy.getBounds())) continue;

        // 踏みつけ判定
        const prevPlayerBottom = player.y + player.height - player.vy;
        if (player.vy > 0 && prevPlayerBottom <= enemy.y + STOMP_TOLERANCE) {
          // 踏みつけ成功
          enemy.crush();
          this.particles.emit('enemy_death', enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);
          player.score += 50;
          player.vy = PHYSICS.JUMP_VELOCITY * 0.6;
          player.jumpCount = 1;
          this.audio.play('enemy_kill');
        } else if (!player.invincible) {
          // ダメージ
          this._applyDamage();
        }
      }
    }

    // ===== 8. コイン収集 =====
    const playerBounds = player.getBounds();
    for (const coin of stage.coins) {
      if (coin.collected) continue;
      if (isOverlapping(playerBounds, coin.getBounds())) {
        coin.collected = true;
        player.score += 10;
        this.particles.emit('coin', coin.x, coin.y);
        this.audio.play('coin');
      }
    }

    // ===== 9. ゴール判定 =====
    if (isOverlapping(playerBounds, stage.goal.getBounds())) {
      this.stageClearTime = elapsed;
      this.totalElapsedSeconds += elapsed;
      this.audio.play('stage_clear');
      this.state = GameState.STAGE_CLEAR;
    }

    // ===== 10. ゴール更新 =====
    stage.goal.update();

    // ===== 11. パーティクル更新 =====
    this.particles.update();

    // ===== 12. カメラ更新 =====
    this.camera.update(player.x, stage.worldWidth);
  }

  /**
   * @private ダメージを与える
   */
  _applyDamage() {
    const player = this.player;
    if (player.invincible) return;
    player.lives -= 1;
    if (player.lives <= 0) {
      player.lives = 0;
      player.state = PlayerState.DEAD;
      this.audio.play('game_over');
      setTimeout(() => { this.state = GameState.GAME_OVER; }, 1000);
      return;
    }
    player.invincible = true;
    player.invincibleTimer = 120;
    player.vy = PHYSICS.JUMP_VELOCITY * 0.5;
    player.vx = -player.facing * 3;
    this.audio.play('damage');
  }

  // ============================================================
  // 描画
  // ============================================================

  /** @private 毎フレームの描画処理 */
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 800, 450);

    if (this.state === GameState.MENU) {
      this._drawMenu();
    } else if (this.state === GameState.PLAYING || this.state === GameState.STAGE_CLEAR ||
               this.state === GameState.GAME_OVER || this.state === GameState.GAME_COMPLETE) {
      // ゲーム本体を描画（全状態で背景・ゲームオブジェクトを描画）
      if (this.currentStage) {
        this._drawGame();
      }

      if (this.state === GameState.STAGE_CLEAR) {
        this._drawStageClear();
      } else if (this.state === GameState.GAME_OVER) {
        this._drawGameOver();
      } else if (this.state === GameState.GAME_COMPLETE) {
        this._drawGameComplete();
      }
    }
  }

  /** @private ゲーム本体の描画 */
  _drawGame() {
    const ctx = this.ctx;
    const stage = this.currentStage;
    const cameraX = this.camera.x;

    // 背景（視差スクロール）
    this._drawBackground(ctx, cameraX);

    // プラットフォーム
    stage.platforms.forEach(p => p.draw(ctx, cameraX));

    // ゴール
    stage.goal.draw(ctx, cameraX);

    // コイン
    stage.coins.forEach(c => c.draw(ctx, cameraX, this.frameCount));

    // 敵
    stage.enemies.forEach(e => e.draw(ctx, cameraX));

    // プレイヤー
    this.player.draw(ctx, cameraX, this.frameCount);

    // パーティクル
    this.particles.draw(ctx, cameraX);

    // HUD
    const coinsCollected = stage.coins.filter(c => c.collected).length;
    const totalCoins = stage.coins.length;
    const elapsed = (Date.now() - this.stageStartTime) / 1000; // Date.now()で実経過時間を計測
    this.hud.draw(ctx, this.player, this.currentStageIndex, elapsed, coinsCollected, totalCoins);

    // モバイル仮想ボタン
    if (this.isTouchDevice) {
      this._drawTouchButtons(ctx);
    }
  }

  /**
   * @private 視差スクロール背景を描画
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   */
  _drawBackground(ctx, cameraX) {
    // Layer 0: 空グラデーション（固定）
    const grad = ctx.createLinearGradient(0, 0, 0, 450);
    grad.addColorStop(0, '#87CEEB');
    grad.addColorStop(1, '#E0F0FF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 450);

    // Layer 1: 遠景の山（係数0.2）
    const parallax1X = -(cameraX * 0.2) % 800;
    ctx.fillStyle = '#9B8B7A';
    for (let i = -1; i <= 2; i++) {
      const mx = i * 400 + parallax1X;
      ctx.beginPath();
      ctx.moveTo(mx, 450);
      ctx.lineTo(mx + 200, 200);
      ctx.lineTo(mx + 400, 450);
      ctx.closePath();
      ctx.fill();
    }

    // Layer 2: 中景の丘（係数0.5）
    const parallax2X = -(cameraX * 0.5) % 800;
    ctx.fillStyle = '#4A7C40';
    for (let i = -1; i <= 2; i++) {
      const hx = i * 500 + parallax2X;
      ctx.beginPath();
      ctx.arc(hx + 250, 500, 200, 0, Math.PI, true);
      ctx.fill();
    }
  }

  /**
   * @private モバイル仮想ボタンを描画
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawTouchButtons(ctx) {
    const buttons = [
      { x: 60,  y: 410, r: 35, label: '◀', active: this.touchButtons.left },
      { x: 145, y: 410, r: 35, label: '▶', active: this.touchButtons.right },
      { x: 740, y: 410, r: 40, label: '▲', active: this.touchButtons.jump },
    ];

    buttons.forEach(btn => {
      ctx.fillStyle = btn.active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, btn.x, btn.y);
    });
  }

  /** @private メニュー画面を描画 */
  _drawMenu() {
    const ctx = this.ctx;

    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, 450);
    grad.addColorStop(0, '#1a1a3e');
    grad.addColorStop(1, '#0d0d1e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 450);

    // 星を描画
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 50; i++) {
      const sx = (i * 173 + 37) % 800;
      const sy = (i * 97 + 23) % 350;
      const size = (i % 3) + 1;
      ctx.fillRect(sx, sy, size, size);
    }

    // タイトル
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Canvas Platformer', 400, 150);

    // サブタイトル
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px Arial';
    ctx.fillText('HTML5 Canvas Adventure', 400, 190);

    // 操作説明
    ctx.fillStyle = '#CCCCCC';
    ctx.font = '16px Arial';
    ctx.fillText('Arrow Keys / WASD: Move    Space/↑/W: Jump (Double Jump OK!)', 400, 235);
    ctx.fillText('Reach the green flag to clear each stage!', 400, 260);

    // START ボタン
    drawButton(ctx, 400, 290, 200, 50, '#4CAF50', 'START GAME', 'white', 'bold 20px Arial');

    ctx.textBaseline = 'alphabetic';
  }

  /** @private ステージクリア画面を描画 */
  _drawStageClear() {
    const ctx = this.ctx;

    // オーバーレイ
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 800, 450);

    // タイトル
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`STAGE ${this.currentStageIndex + 1} CLEAR!`, 400, 160);

    // スコア
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '24px Arial';
    ctx.fillText(`Score: ${this.player.score}`, 400, 210);

    // タイム
    ctx.fillStyle = '#CCCCCC';
    ctx.font = '20px Arial';
    ctx.fillText(`Time: ${this.stageClearTime.toFixed(1)}s`, 400, 245);

    // ボタン
    const btnLabel = this.currentStageIndex < 2 ? 'NEXT STAGE' : 'FINISH';
    drawButton(ctx, 400, 290, 200, 50, '#4CAF50', btnLabel, 'white', 'bold 20px Arial');

    ctx.textBaseline = 'alphabetic';
  }

  /** @private ゲームオーバー画面を描画 */
  _drawGameOver() {
    const ctx = this.ctx;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 800, 450);

    ctx.fillStyle = '#FF4444';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GAME OVER', 400, 160);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '24px Arial';
    ctx.fillText(`Score: ${this.player.score}`, 400, 210);

    drawButton(ctx, 400, 270, 200, 50, '#FF6B6B', 'RETRY', 'white', 'bold 20px Arial');

    ctx.textBaseline = 'alphabetic';
  }

  /** @private ゲームコンプリート画面を描画 */
  _drawGameComplete() {
    const ctx = this.ctx;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 800, 450);

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONGRATULATIONS!', 400, 140);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '24px Arial';
    ctx.fillText('ALL STAGES CLEAR!', 400, 185);

    ctx.fillStyle = '#FFFF00';
    ctx.font = '22px Arial';
    ctx.fillText(`Final Score: ${this.player.score}`, 400, 225);

    ctx.fillStyle = '#CCCCCC';
    ctx.font = '20px Arial';
    ctx.fillText(`Total Time: ${this.totalElapsedSeconds.toFixed(1)}s`, 400, 260);

    drawButton(ctx, 400, 310, 220, 50, '#4CAF50', 'BACK TO MENU', 'white', 'bold 18px Arial');

    ctx.textBaseline = 'alphabetic';
  }
}

// ============================================================
// エントリーポイント
// ============================================================

const game = new Game();
game.init();

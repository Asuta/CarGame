import Phaser from "phaser";
import { RaceSimulation, raceRules } from "../simulation/RaceSimulation";
import type { PlayerId, RaceState } from "../simulation/raceTypes";

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 640;
const PANEL_GAP = 42;
const ROAD_X = 28;
const ROAD_WIDTH = PANEL_WIDTH - ROAD_X * 2;
const METER_PIXELS = 18;
const PLAYER_ANCHOR_Y = PANEL_HEIGHT - 138;
const FAR_MARKER_LIMIT_METERS = 26;

interface ViewConfig {
  id: PlayerId;
  color: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  frame: Phaser.GameObjects.Graphics;
  marker: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private simulation = new RaceSimulation();
  private views: ViewConfig[] = [];
  private roadGraphics!: Phaser.GameObjects.Graphics;
  private playerSprites = new Map<PlayerId, Phaser.GameObjects.Image>();
  private obstacleSprites = new Map<number, Phaser.GameObjects.Image>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<"a" | "d" | "w", Phaser.Input.Keyboard.Key>;

  constructor() {
    super("game");
  }

  create() {
    this.createTextures();
    this.roadGraphics = this.add.graphics();
    this.createCars();
    this.createViews();
    this.bindInput();
    this.bindRestart();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
    this.layout();
    this.publishHud();
  }

  update(_time: number, delta: number) {
    this.handleInput();
    this.simulation.update(Math.min(delta / 1000, 0.05));
    this.syncSprites();
    this.drawRoad();
    this.updateCameras();
    this.drawViewFrames();
    this.updateOpponentMarkers();
    this.publishHud();
  }

  private bindInput() {
    if (!this.input.keyboard) {
      throw new Error("Keyboard input is unavailable.");
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      w: Phaser.Input.Keyboard.KeyCodes.W,
    }) as Record<"a" | "d" | "w", Phaser.Input.Keyboard.Key>;
  }

  private handleInput() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.a)) {
      this.simulation.applyAction({ type: "move-left", playerId: "p1" });
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.d)) {
      this.simulation.applyAction({ type: "move-right", playerId: "p1" });
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.w)) {
      this.simulation.applyAction({ type: "boost", playerId: "p1" });
      this.flashPlayerView("p1", 255, 64, 64);
    }
    if (this.cursors.left && Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
      this.simulation.applyAction({ type: "move-left", playerId: "p2" });
    }
    if (this.cursors.right && Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
      this.simulation.applyAction({ type: "move-right", playerId: "p2" });
    }
    if (this.cursors.up && Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.simulation.applyAction({ type: "boost", playerId: "p2" });
      this.flashPlayerView("p2", 64, 160, 255);
    }
  }

  private flashPlayerView(playerId: PlayerId, red: number, green: number, blue: number) {
    const view = this.views.find((candidate) => candidate.id === playerId);
    view?.camera.flash(80, red, green, blue, false);
  }

  private bindRestart() {
    window.addEventListener("race:restart", () => {
      this.simulation.reset();
      this.syncSprites();
      this.publishHud();
    });
  }

  private createViews() {
    this.cameras.main.setBackgroundColor(0x07070c);
    const left = this.cameras.main;
    const right = this.cameras.add(0, 0, PANEL_WIDTH, PANEL_HEIGHT);

    this.views = [
      {
        id: "p1",
        color: 0xff3b4f,
        camera: left,
        frame: this.add.graphics().setDepth(50),
        marker: this.add.text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "22px",
          color: "#ffe66d",
          stroke: "#08080e",
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(60),
      },
      {
        id: "p2",
        color: 0x45a3ff,
        camera: right,
        frame: this.add.graphics().setDepth(50),
        marker: this.add.text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "22px",
          color: "#8dd7ff",
          stroke: "#08080e",
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(60),
      },
    ];

    left.ignore([this.views[1].frame, this.views[1].marker]);
    right.ignore([this.views[0].frame, this.views[0].marker]);
  }

  private layout() {
    const width = this.scale.width;
    const height = this.scale.height;
    const scale = Math.min(width / (PANEL_WIDTH * 2 + PANEL_GAP), height / PANEL_HEIGHT, 1.08);
    const viewWidth = Math.floor(PANEL_WIDTH * scale);
    const viewHeight = Math.floor(PANEL_HEIGHT * scale);
    const gap = Math.floor(PANEL_GAP * scale);
    const leftX = Math.floor((width - viewWidth * 2 - gap) / 2);
    const topY = Math.floor((height - viewHeight) / 2);

    const viewports = [
      { x: leftX, y: topY },
      { x: leftX + viewWidth + gap, y: topY },
    ];

    this.views.forEach((view, index) => {
      view.camera.setViewport(viewports[index].x, viewports[index].y, viewWidth, viewHeight);
      view.camera.setZoom(scale);
      void index;
    });
  }

  private createTextures() {
    this.makeCarTexture("car-p1", 0xff344d, 0xffffff);
    this.makeCarTexture("car-p2", 0x2f8cff, 0xffffff);
    this.makeCarTexture("car-traffic", 0xffc857, 0x15151f);
  }

  private makeCarTexture(key: string, bodyColor: number, windowColor: number) {
    const graphics = this.add.graphics();
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRect(6, 0, 22, 50);
    graphics.fillRect(0, 10, 34, 30);
    graphics.fillStyle(windowColor, 1);
    graphics.fillRect(10, 8, 14, 10);
    graphics.fillRect(10, 30, 14, 8);
    graphics.fillStyle(0x05050a, 1);
    graphics.fillRect(2, 6, 5, 10);
    graphics.fillRect(27, 6, 5, 10);
    graphics.fillRect(2, 34, 5, 10);
    graphics.fillRect(27, 34, 5, 10);
    graphics.generateTexture(key, 34, 50);
    graphics.destroy();
  }

  private createCars() {
    this.playerSprites.set("p1", this.add.image(0, 0, "car-p1").setDepth(20));
    this.playerSprites.set("p2", this.add.image(0, 0, "car-p2").setDepth(21));
  }

  private syncSprites() {
    const state = this.simulation.getState();
    for (const player of Object.values(state.players)) {
      const sprite = this.playerSprites.get(player.id);
      if (!sprite) {
        continue;
      }
      sprite.setPosition(this.laneToX(player.lane), this.distanceToY(player.distanceMeters));
      sprite.setAlpha(player.crashed ? 0.45 : 1);
      sprite.setAngle(player.crashed ? (player.id === "p1" ? -12 : 12) : 0);
    }

    const activeObstacleIds = new Set<number>();
    for (const obstacle of state.obstacles) {
      activeObstacleIds.add(obstacle.id);
      let sprite = this.obstacleSprites.get(obstacle.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, "car-traffic").setDepth(10);
        this.obstacleSprites.set(obstacle.id, sprite);
      }
      sprite.setPosition(this.laneToX(obstacle.lane), this.distanceToY(obstacle.distanceMeters));
    }

    for (const [id, sprite] of this.obstacleSprites.entries()) {
      if (!activeObstacleIds.has(id)) {
        sprite.destroy();
        this.obstacleSprites.delete(id);
      }
    }
  }

  private drawRoad() {
    const state = this.simulation.getState();
    const minDistance = Math.min(state.players.p1.distanceMeters, state.players.p2.distanceMeters) - 45;
    const maxDistance = Math.max(state.players.p1.distanceMeters, state.players.p2.distanceMeters) + 240;
    const topY = this.distanceToY(maxDistance);
    const bottomY = this.distanceToY(minDistance);

    this.roadGraphics.clear();
    this.roadGraphics.fillStyle(0x191923, 1);
    this.roadGraphics.fillRect(ROAD_X, topY, ROAD_WIDTH, bottomY - topY);
    this.roadGraphics.lineStyle(4, 0xe8e1b8, 1);
    this.roadGraphics.lineBetween(ROAD_X, topY, ROAD_X, bottomY);
    this.roadGraphics.lineBetween(ROAD_X + ROAD_WIDTH, topY, ROAD_X + ROAD_WIDTH, bottomY);

    for (let lane = 1; lane < raceRules.laneCount; lane += 1) {
      const x = ROAD_X + (ROAD_WIDTH / raceRules.laneCount) * lane;
      this.roadGraphics.lineStyle(2, 0x4f5168, 1);
      this.roadGraphics.lineBetween(x, topY, x, bottomY);
    }

    this.roadGraphics.lineStyle(6, 0xffffff, 1);
    const dashMeters = 7;
    const start = Math.floor(minDistance / dashMeters) * dashMeters;
    for (let distance = start; distance < maxDistance; distance += dashMeters) {
      const y = this.distanceToY(distance);
      this.roadGraphics.lineBetween(PANEL_WIDTH / 2, y - 24, PANEL_WIDTH / 2, y - 62);
    }
  }

  private updateCameras() {
    const state = this.simulation.getState();
    for (const view of this.views) {
      const player = state.players[view.id];
      view.camera.setScroll(0, this.distanceToY(player.distanceMeters) - PLAYER_ANCHOR_Y);
    }
  }

  private updateOpponentMarkers() {
    const state = this.simulation.getState();
    for (const view of this.views) {
      const opponentId: PlayerId = view.id === "p1" ? "p2" : "p1";
      const player = state.players[view.id];
      const opponent = state.players[opponentId];
      const deltaMeters = opponent.distanceMeters - player.distanceMeters;
      const isFar = Math.abs(deltaMeters) > FAR_MARKER_LIMIT_METERS;

      if (!isFar) {
        view.marker.setText("");
        continue;
      }

      const label = opponentId.toUpperCase();
      view.marker.setText(deltaMeters > 0 ? `▲ ${label} +${deltaMeters.toFixed(0)}m` : `▼ ${label} ${deltaMeters.toFixed(0)}m`);
      view.marker.setPosition(
        PANEL_WIDTH / 2,
        view.camera.scrollY + (deltaMeters > 0 ? 34 : PANEL_HEIGHT - 34) / view.camera.zoom,
      );
    }
  }

  private drawViewFrames() {
    for (const view of this.views) {
      const lineWidth = 4 / view.camera.zoom;
      const inset = 3 / view.camera.zoom;
      view.frame.clear();
      view.frame.lineStyle(lineWidth, view.color, 1);
      view.frame.strokeRect(
        inset,
        view.camera.scrollY + inset,
        PANEL_WIDTH - inset * 2,
        PANEL_HEIGHT / view.camera.zoom - inset * 2,
      );
    }
  }

  private publishHud() {
    const state = this.simulation.getState();
    window.dispatchEvent(
      new CustomEvent<RaceState>("race:update", {
        detail: state,
      }),
    );
  }

  private laneToX(lane: number) {
    const laneWidth = ROAD_WIDTH / raceRules.laneCount;
    return ROAD_X + laneWidth * lane + laneWidth / 2;
  }

  private distanceToY(distanceMeters: number) {
    return -distanceMeters * METER_PIXELS;
  }
}

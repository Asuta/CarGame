import Phaser from "phaser";
import { advancePredictedState, applyPredictedAction, mergePredictedState } from "../simulation/clientPrediction";
import { RaceSimulation, raceRules } from "../simulation/RaceSimulation";
import type { PlayerId, RaceAction, RaceState } from "../simulation/raceTypes";

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 640;
const PANEL_GAP = 30;
const ROAD_X = 28;
const ROAD_WIDTH = PANEL_WIDTH - ROAD_X * 2;
const METER_PIXELS = 18;
const PLAYER_ANCHOR_Y = PANEL_HEIGHT - 138;
const FAR_MARKER_LIMIT_METERS = 26;

type GameMode = "idle" | "local" | "online";

interface PlayerMeta {
  id: PlayerId;
  nickname: string;
}

interface ConfigureGameDetail {
  mode: "local" | "online";
  players: PlayerMeta[];
  controlledPlayerIds: PlayerId[];
}

interface ViewConfig {
  id: PlayerId;
  color: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  frame: Phaser.GameObjects.Graphics;
  marker: Phaser.GameObjects.Text;
}

const carColors: Record<PlayerId, number> = {
  p1: 0xff344d,
  p2: 0x2f8cff,
  p3: 0x3ee07f,
};

const frameColors: Record<PlayerId, number> = {
  p1: 0xff3b4f,
  p2: 0x45a3ff,
  p3: 0x3ee07f,
};

export class GameScene extends Phaser.Scene {
  private simulation = new RaceSimulation();
  private mode: GameMode = "idle";
  private state: RaceState = this.simulation.getState();
  private views: ViewConfig[] = [];
  private playerSprites = new Map<PlayerId, Phaser.GameObjects.Image>();
  private obstacleSprites = new Map<number, Phaser.GameObjects.Image>();
  private controlledPlayerIds = new Set<PlayerId>();
  private roadGraphics!: Phaser.GameObjects.Graphics;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<"a" | "d" | "w" | "j" | "l" | "i", Phaser.Input.Keyboard.Key>;

  constructor() {
    super("game");
  }

  create() {
    this.createTextures();
    this.roadGraphics = this.add.graphics();
    this.bindInput();
    this.bindEvents();
    this.scale.on("resize", this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.layout, this);
    });
    this.layout();
  }

  update(_time: number, delta: number) {
    if (this.mode === "idle") {
      return;
    }

    this.handleInput();
    if (this.mode === "local") {
      this.simulation.update(Math.min(delta / 1000, 0.05));
      this.state = this.simulation.getState();
    } else {
      this.state = advancePredictedState(this.state, Math.min(delta / 1000, 0.05));
    }

    this.renderState();
    this.publishState();
  }

  private bindEvents() {
    window.addEventListener("game:configure", (event) => {
      const detail = (event as CustomEvent<ConfigureGameDetail>).detail;
      this.mode = detail.mode;
      this.controlledPlayerIds = new Set(detail.controlledPlayerIds);
      this.simulation = new RaceSimulation(detail.players.length);
      this.state = this.simulation.getState();
      this.createViews(detail.players.map((player) => player.id));
      this.renderState();
      this.publishState();
    });

    window.addEventListener("game:state", (event) => {
      const serverState = (event as CustomEvent<RaceState>).detail;
      this.state = this.mode === "online"
        ? mergePredictedState(this.state, serverState, this.controlledPlayerIds)
        : serverState;
      this.renderState();
      this.publishState();
    });

    window.addEventListener("game:stop", () => {
      this.mode = "idle";
      this.controlledPlayerIds.clear();
    });
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
      j: Phaser.Input.Keyboard.KeyCodes.J,
      l: Phaser.Input.Keyboard.KeyCodes.L,
      i: Phaser.Input.Keyboard.KeyCodes.I,
    }) as Record<"a" | "d" | "w" | "j" | "l" | "i", Phaser.Input.Keyboard.Key>;
  }

  private handleInput() {
    this.handlePlayerInput("p1", this.keys.a, this.keys.d, this.keys.w, [255, 64, 64]);
    if (this.cursors.left && this.cursors.right && this.cursors.up) {
      this.handlePlayerInput("p2", this.cursors.left, this.cursors.right, this.cursors.up, [64, 160, 255]);
    }
    this.handlePlayerInput("p3", this.keys.j, this.keys.l, this.keys.i, [64, 255, 144]);
  }

  private handlePlayerInput(
    playerId: PlayerId,
    leftKey: Phaser.Input.Keyboard.Key,
    rightKey: Phaser.Input.Keyboard.Key,
    boostKey: Phaser.Input.Keyboard.Key,
    flashColor: [number, number, number],
  ) {
    if (!this.controlledPlayerIds.has(playerId) || !this.state.players.some((player) => player.id === playerId)) {
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(leftKey)) {
      this.applyAction({ type: "move-left", playerId });
    }
    if (Phaser.Input.Keyboard.JustDown(rightKey)) {
      this.applyAction({ type: "move-right", playerId });
    }
    if (Phaser.Input.Keyboard.JustDown(boostKey)) {
      this.applyAction({ type: "boost", playerId });
      this.flashPlayerView(playerId, ...flashColor);
    }
  }

  private applyAction(action: RaceAction) {
    if (this.mode === "local") {
      this.simulation.applyAction(action);
      this.state = this.simulation.getState();
    } else if (this.mode === "online") {
      this.state = applyPredictedAction(this.state, action);
    }
    window.dispatchEvent(new CustomEvent("game:action", { detail: action }));
  }

  private createViews(playerIds: PlayerId[]) {
    for (const view of this.views) {
      if (view.camera !== this.cameras.main) {
        this.cameras.remove(view.camera);
      }
      view.frame.destroy();
      view.marker.destroy();
    }
    this.views = [];
    this.cameras.main.setBackgroundColor(0x07070c);

    playerIds.forEach((playerId, index) => {
      const camera = index === 0 ? this.cameras.main : this.cameras.add(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
      this.views.push({
        id: playerId,
        color: frameColors[playerId],
        camera,
        frame: this.add.graphics().setDepth(50),
        marker: this.add.text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#ffe66d",
          stroke: "#08080e",
          strokeThickness: 4,
          align: "center",
        }).setOrigin(0.5).setDepth(60),
      });
    });

    for (const view of this.views) {
      const ignored = this.views
        .filter((candidate) => candidate.id !== view.id)
        .flatMap((candidate) => [candidate.frame, candidate.marker]);
      view.camera.ignore(ignored);
    }
    this.layout();
  }

  private layout() {
    if (this.views.length === 0) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const count = this.views.length;
    const totalPanelWidth = PANEL_WIDTH * count + PANEL_GAP * (count - 1);
    const scale = Math.min(width / totalPanelWidth, height / PANEL_HEIGHT, 1.08);
    const viewWidth = Math.floor(PANEL_WIDTH * scale);
    const viewHeight = Math.floor(PANEL_HEIGHT * scale);
    const gap = Math.floor(PANEL_GAP * scale);
    const leftX = Math.floor((width - viewWidth * count - gap * (count - 1)) / 2);
    const topY = Math.floor((height - viewHeight) / 2);

    this.views.forEach((view, index) => {
      view.camera.setViewport(leftX + index * (viewWidth + gap), topY, viewWidth, viewHeight);
      view.camera.setZoom(scale);
    });
  }

  private createTextures() {
    for (const playerId of raceRules.playerIds) {
      this.makeCarTexture(`car-${playerId}`, carColors[playerId], 0xffffff);
    }
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

  private renderState() {
    this.syncSprites();
    this.drawRoad();
    this.updateCameras();
    this.drawViewFrames();
    this.updateOpponentMarkers();
  }

  private syncSprites() {
    const activePlayerIds = new Set<PlayerId>();
    for (const player of this.state.players) {
      activePlayerIds.add(player.id);
      let sprite = this.playerSprites.get(player.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, `car-${player.id}`).setDepth(20);
        this.playerSprites.set(player.id, sprite);
      }
      sprite.setPosition(this.laneToX(player.lane), this.distanceToY(player.distanceMeters));
      sprite.setAlpha(player.crashed ? 0.35 : 1);
      sprite.setAngle(player.crashed ? -14 : 0);
    }

    for (const [playerId, sprite] of this.playerSprites.entries()) {
      if (!activePlayerIds.has(playerId)) {
        sprite.destroy();
        this.playerSprites.delete(playerId);
      }
    }

    const activeObstacleIds = new Set<number>();
    for (const obstacle of this.state.obstacles) {
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
    if (this.state.players.length === 0) {
      return;
    }

    const minDistance = Math.min(...this.state.players.map((player) => player.distanceMeters)) - 45;
    const maxDistance = Math.max(...this.state.players.map((player) => player.distanceMeters)) + 240;
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
    for (const view of this.views) {
      const player = this.state.players.find((candidate) => candidate.id === view.id);
      if (player) {
        view.camera.setScroll(0, this.distanceToY(player.distanceMeters) - PLAYER_ANCHOR_Y);
      }
    }
  }

  private updateOpponentMarkers() {
    for (const view of this.views) {
      const player = this.state.players.find((candidate) => candidate.id === view.id);
      if (!player) {
        view.marker.setText("");
        continue;
      }

      const lines = this.state.players
        .filter((candidate) => candidate.id !== view.id)
        .map((opponent) => ({
          id: opponent.id.toUpperCase(),
          deltaMeters: opponent.distanceMeters - player.distanceMeters,
        }))
        .filter((opponent) => Math.abs(opponent.deltaMeters) > FAR_MARKER_LIMIT_METERS)
        .map((opponent) => opponent.deltaMeters > 0
          ? `▲ ${opponent.id} +${opponent.deltaMeters.toFixed(0)}m`
          : `▼ ${opponent.id} ${opponent.deltaMeters.toFixed(0)}m`);

      view.marker.setText(lines.join("\n"));
      view.marker.setPosition(PANEL_WIDTH / 2, view.camera.scrollY + 34 / view.camera.zoom);
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

  private flashPlayerView(playerId: PlayerId, red: number, green: number, blue: number) {
    const view = this.views.find((candidate) => candidate.id === playerId);
    view?.camera.flash(80, red, green, blue, false);
  }

  private publishState() {
    window.dispatchEvent(new CustomEvent("race:update", { detail: this.state }));
  }

  private laneToX(lane: number) {
    const laneWidth = ROAD_WIDTH / raceRules.laneCount;
    return ROAD_X + laneWidth * lane + laneWidth / 2;
  }

  private distanceToY(distanceMeters: number) {
    return -distanceMeters * METER_PIXELS;
  }
}

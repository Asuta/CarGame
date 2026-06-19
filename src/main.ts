import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";
import { bindHud } from "./ui/hud";
import "./styles.css";

bindHud();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#08080e",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 760,
  },
  scene: [GameScene],
};

new Phaser.Game(config);

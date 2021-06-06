import type { Player } from "../room-activity";
import { ScriptedGame } from "../room-game-scripted";
import type { GameCommandDefinitions, IGameAchievement, IGameFile } from "../types/games";

type AchievementNames = "fishoutofwater" | "goldenmagikarp" | "hightidesurvivor";

interface IWheel {
	magikarpChance: number;
	slots: number[];
}

interface IWheels {
	Blue: IWheel;
	Green: IWheel;
	Orange: IWheel;
	Purple: IWheel;
	Red: IWheel;
}

type WheelsKey = keyof IWheels;

const fishOutOfWaterPoints = 4000;
const goldenMagikarpPoints = 1000;
const highTideSurvivorWheel: WheelsKey = 'Red';
const highTideSurvivorSpins = 5;

const SWIM_COMMAND = 'swim';
const TREAD_COMMAND = 'tread';
const STAY_COMMAND = 'stay';
const SWIM_UP = 'up';
const SWIM_DOWN = 'down';

class MagikarpsWaterWheel extends ScriptedGame {
	static achievements: KeyedDict<AchievementNames, IGameAchievement> = {
		'fishoutofwater': {name: "Fish out of Water", type: 'points', bits: 1000, description: "get at least 4000 points"},
		'goldenmagikarp': {name: "Golden Magikarp", type: 'special', bits: 1000, description: "get lucky and find the golden Magikarp"},
		'hightidesurvivor': {name: "High Tide Survivor", type: 'special', bits: 1000, description: "survive 5 rounds in the red wheel"},
	};

	actionCommands: string[] = ['swim', 'tread', 'stay'];
	canLateJoin: boolean = true;
	canSwim: boolean = false;
	consecutiveWheelSpins = new Map<Player, number>();
	maxRound: number = 20;
	playerWheels = new Map<Player, WheelsKey>();
	points = new Map<Player, number>();
	roundActions = new Set<Player>();
	roundCarp: boolean = false;
	wheelKeys: WheelsKey[] = ['Purple', 'Blue', 'Green', 'Orange', 'Red'];
	wheels: IWheels = {
		'Purple': {
			magikarpChance: 5,
			slots: [100, 100, 100, 100, 200, 200, 200, 200, 300, 300, 300, 400],
		},
		'Blue': {
			magikarpChance: 10,
			slots: [200, 200, 200, 200, 300, 300, 300, 300, 400, 400, 400, 500],
		},
		'Green': {
			magikarpChance: 20,
			slots: [300, 300, 300, 300, 400, 400, 400, 400, 500, 500, 500, 600],
		},
		'Orange': {
			magikarpChance: 35,
			slots: [400, 400, 400, 400, 500, 500, 500, 500, 600, 600, 600, 700],
		},
		'Red': {
			magikarpChance: 50,
			slots: [500, 500, 500, 500, 600, 600, 600, 600, 700, 700, 700, 800],
		},
	};

	onAddPlayer(player: Player, lateJoin?: boolean): boolean {
		if (lateJoin) {
			if (this.round > 1) return false;
		}
		this.playerWheels.set(player, this.wheelKeys[0]);
		return true;
	}

	onStart(): void {
		this.say("Use ``" + Config.commandCharacter + "swim [up/down]`` to swim to a higher/lower wheel, ``" +
			Config.commandCharacter + "tread`` to remain on your current wheel, or ``" + Config.commandCharacter + "stay`` to stop with " +
			"your current score any round!");
		this.nextRound();
	}

	spinWheel(player: Player): void {
		const wheel = this.playerWheels.get(player)!;
		const wheelStats = this.wheels[wheel];
		let html = '<center><h3>' + wheel.charAt(0).toUpperCase() + wheel.substr(1) + ' wheel</h3>';
		let magikarp = false;
		let goldenMagikarp = false;
		if (this.random(100) <= wheelStats.magikarpChance) {
			magikarp = true;
			const gif = Dex.getPokemonModel(this.mascot!);
			if (gif) html += gif + "<br />";
			html += "You were karped!";
		} else {
			let points = this.points.get(player) || 0;
			if (!this.random(100)) {
				goldenMagikarp = true;
				points += goldenMagikarpPoints;
				html += 'The wheel landed on <b>Golden Magikarp (' + goldenMagikarpPoints + ' points)</b>!';
			} else {
				const spin = this.sampleOne(wheelStats.slots);
				points += spin;
				html += 'The wheel landed on <b>' + spin + ' points</b>!';
			}
			this.points.set(player, points);
			html += '&nbsp;Your total is now <b>' + points + '</b>.';
		}

		html += '</center>';
		player.sayPrivateUhtml(this.getCustomBoxDiv(html), this.actionSummaryUhtmlName);

		if (magikarp) {
			this.eliminatePlayer(player, "The wheel landed on a Magikarp!");
		} else {
			let consecutiveWheels = this.consecutiveWheelSpins.get(player) || 0;
			consecutiveWheels++;
			this.consecutiveWheelSpins.set(player, consecutiveWheels);
			if (wheel === highTideSurvivorWheel && consecutiveWheels === highTideSurvivorSpins) {
				this.unlockAchievement(player, MagikarpsWaterWheel.achievements.hightidesurvivor);
			}

			if (goldenMagikarp) this.unlockAchievement(player, MagikarpsWaterWheel.achievements.goldenmagikarp);
		}
	}

	onNextRound(): void {
		this.canSwim = false;
		if (this.round > 1) {
			for (const i in this.players) {
				if (this.players[i].eliminated || this.players[i].frozen) continue;
				this.spinWheel(this.players[i]);
			}
		}

		const len = this.getRemainingPlayerCount();
		if (!len) return this.end();
		this.roundActions.clear();
		this.roundCarp = false;

		this.onCommands(this.actionCommands, {max: len, remainingPlayersMax: true}, () => this.nextRound());

		const uhtmlName = this.uhtmlBaseName + '-round';
		const html = this.getRoundHtml(players => this.getPlayerPoints(players));
		this.onUhtml(uhtmlName, html, () => {
			this.canSwim = true;

			const lastIndex = this.wheelKeys.length - 1;
			for (const i in this.players) {
				if (this.players[i].eliminated || this.players[i].frozen) continue;
				const player = this.players[i];
				const wheel = this.playerWheels.get(player)!;
				const index = this.wheelKeys.indexOf(wheel);

				const buttons: string[] = [];
				if (index > 0) {
					buttons.push(this.getMsgRoomButton(SWIM_COMMAND + " " + SWIM_DOWN, "Swim down to " + this.wheelKeys[index - 1]));
				} else {
					buttons.push(this.getMsgRoomButton(SWIM_COMMAND + " " + SWIM_DOWN, "Swim down", true));
				}

				buttons.push(this.getMsgRoomButton(TREAD_COMMAND, "Tread on " + this.wheelKeys[index]));

				if (index !== lastIndex) {
					buttons.push(this.getMsgRoomButton(SWIM_COMMAND + " " + SWIM_UP, "Swim up to " + this.wheelKeys[index + 1]));
				} else {
					buttons.push(this.getMsgRoomButton(SWIM_COMMAND + " " + SWIM_UP, "Swim up", true));
				}

				const points = this.points.get(player);
				if (points) {
					buttons.push(this.getMsgRoomButton(STAY_COMMAND, "Stop at " + points));
				} else {
					buttons.push(this.getMsgRoomButton(STAY_COMMAND, "Stop", true));
				}

				player.sayPrivateUhtml(this.getCustomButtonsDiv(buttons), this.actionButtonsUhtmlName);
			}

			this.timeout = setTimeout(() => this.nextRound(), 30 * 1000);
		});
		this.sayUhtml(uhtmlName, html);
	}

	onEnd(): void {
		const bits = new Map<Player, number>();
		let highestPoints = 0;
		const reachedAchievementPoints: Player[] = [];
		for (const i in this.players) {
			if (this.players[i].eliminated) continue;
			const player = this.players[i];
			const points = this.points.get(player);
			if (!points) continue;
			if (points >= fishOutOfWaterPoints) reachedAchievementPoints.push(player);
			bits.set(player, Math.min(250, points / 10));
			if (points > highestPoints) {
				this.winners.clear();
				this.winners.set(player, points);
				highestPoints = points;
			} else if (points === highestPoints) {
				this.winners.set(player, points);
			}
		}

		bits.forEach((amount, player) => {
			if (this.winners.has(player)) {
				this.addBits(player, 500);
			} else {
				this.addBits(player, amount);
			}
		});

		if (reachedAchievementPoints.length) {
			this.unlockAchievement(reachedAchievementPoints, MagikarpsWaterWheel.achievements.fishoutofwater);
		}

		this.announceWinners();
	}
}

const commands: GameCommandDefinitions<MagikarpsWaterWheel> = {
	[SWIM_COMMAND]: {
		command(target, room, user) {
			if (!this.canSwim || this.players[user.id].frozen || this.roundActions.has(this.players[user.id])) return false;
			const player = this.players[user.id];
			const wheel = this.playerWheels.get(player)!;
			const direction = Tools.toId(target);
			let newWheel: WheelsKey;
			if (direction === SWIM_UP) {
				if (wheel === this.wheelKeys[this.wheelKeys.length - 1]) {
					player.say("You are already on the highest wheel.");
					return false;
				}
				newWheel = this.wheelKeys[this.wheelKeys.indexOf(wheel) + 1];
			} else if (direction === SWIM_DOWN) {
				if (wheel === this.wheelKeys[0]) {
					player.say("You are already on the lowest wheel.");
					return false;
				}
				newWheel = this.wheelKeys[this.wheelKeys.indexOf(wheel) - 1];
			} else {
				player.say("You can only swim " + SWIM_UP + " or " + SWIM_DOWN + " wheels.");
				return false;
			}

			this.consecutiveWheelSpins.delete(player);
			this.roundActions.add(player);
			this.playerWheels.set(player, newWheel);
			player.sayPrivateUhtml(this.getCustomBoxDiv("<center><h3>You are now on the " + newWheel.charAt(0).toUpperCase() +
				newWheel.substr(1) + " wheel</h3>The chances of Magikarp have " + (direction === "up" ? "increased" : "decreased") +
				" to <b>" + this.wheels[newWheel].magikarpChance + "%</b>!</center>"), this.uhtmlBaseName + "-swim");
			return true;
		},
	},
	[TREAD_COMMAND]: {
		command(target, room, user) {
			if (!this.canSwim || this.players[user.id].frozen) return false;
			this.roundActions.add(this.players[user.id]);
			return true;
		},
	},
	[STAY_COMMAND]: {
		command(target, room, user) {
			if (!this.canSwim || this.players[user.id].frozen) return false;
			const player = this.players[user.id];
			const points = this.points.get(player);
			if (!points) {
				player.say("You cannot stop without any points!");
				return false;
			}
			player.say("You have stopped with **" + points + "**!");
			player.frozen = true;
			this.roundActions.add(player);
			return true;
		},
	},
};

export const game: IGameFile<MagikarpsWaterWheel> = {
	aliases: ['magikarps', 'mww', 'waterwheel', 'pyl'],
	category: 'luck',
	class: MagikarpsWaterWheel,
	commandDescriptions: [Config.commandCharacter + "swim [up/down]", Config.commandCharacter + "tread", Config.commandCharacter + "stay"],
	commands,
	description: "Each round, players try to gather points by spinning the different color wheels while avoiding Magikarp!",
	formerNames: ['Press Your Luck'],
	name: "Magikarp's Water Wheel",
	mascot: "Magikarp",
	scriptedOnly: true,
};

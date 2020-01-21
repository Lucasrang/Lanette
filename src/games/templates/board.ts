import { Player, PlayerList } from "../../room-activity";
import { Game } from "../../room-game";
import { assert, assertStrictEqual } from "../../test/test-tools";
import { GameFileTests, IGameTemplateFile } from "../../types/games";
import type { HexColor } from "../../types/global-types";

export class BoardSpace {
	name: string;
	color: HexColor;

	isChanceSpace?: boolean;
	isPropertySpace?: boolean;
	isUtilitySpace?: boolean;

	constructor(name: string, color: HexColor) {
		this.name = name;
		this.color = color;
	}
}

export interface IBoard {
	leftColumn: readonly BoardSpace[];
	rightColumn: readonly BoardSpace[];
	topRow: readonly BoardSpace[];
	bottomRow: readonly BoardSpace[];
}

export type BoardSide = keyof IBoard;

export interface IBoardLocation {
	side: BoardSide;
	space: number;
}

export interface IMovedBoardLocation extends IBoardLocation {
	passedSpaces: BoardSpace[];
}

// needs to be in order for getLocationAfterMovement
const boardSides: readonly BoardSide[] = ['leftColumn', 'topRow', 'rightColumn', 'bottomRow'];

export abstract class BoardGame extends Game {
	boardRound: number = 0;
	currentPlayer: Player | null = null;
	dice: number[] = [];
	maxPlayers: number = 25;
	playerLocations = new Map<Player, IBoardLocation>();
	playerList: Player[] = [];
	playerMoney = new Map<Player, number>();
	playerLetters = new Map<Player, string>();
	playerOrder: Player[] = [];
	roundTime: number = 5 * 1000;

	startingMoney?: number;

	abstract board: IBoard;
	abstract numberOfDice: number;
	abstract startingBoardSide: BoardSide;
	abstract startingBoardSpace: number;

	displayBoard() {
		const playerLocations: KeyedDict<IBoard, Dict<Player[]>> = {
			leftColumn: {},
			rightColumn: {},
			topRow: {},
			bottomRow: {},
		};

		for (const id in this.players) {
			const player = this.players[id];
			if (!player.eliminated) {
				const location = this.playerLocations.get(player)!;
				if (!playerLocations[location.side][location.space]) playerLocations[location.side][location.space] = [];
				playerLocations[location.side][location.space].push(player);
			}
		}

		const topCorner = this.board.leftColumn.length - 1;
		const rightColumnOffset = this.board.rightColumn.length - 1;

		let html = '<div class="infobox"><font color="black"><table align="center"; border="2">';
		for (let i = this.board.leftColumn.length - 1; i >= 0; i--) {
			html += "<tr>";
			html += this.getSpaceHtml('leftColumn', i, playerLocations);
			if (i === topCorner) {
				for (let i = 0; i < this.board.topRow.length; i++) {
					html += this.getSpaceHtml('topRow', i, playerLocations);
				}
			} else if (i === 0) {
				for (let i = this.board.bottomRow.length - 1; i >= 0; i--) {
					html += this.getSpaceHtml('bottomRow', i, playerLocations);
				}
			} else {
				for (let i = 0; i < this.board.bottomRow.length; i++) {
					html += "<td>&nbsp;</td>";
				}
			}
			html += this.getSpaceHtml('rightColumn', rightColumnOffset - i, playerLocations);
			html += "</tr>";
		}
		html += "</table></font></div>";

		this.sayUhtml(this.uhtmlBaseName + '-board', html);
	}

	onStart() {
		const letters = Tools.letters.toUpperCase().split("");
		this.playerOrder = this.shufflePlayers();
		for (let i = 0; i < this.playerOrder.length; i++) {
			const player = this.playerOrder[i];
			this.playerLocations.set(player, {side: this.startingBoardSide, space: this.startingBoardSpace});
			if (this.startingMoney) this.playerMoney.set(player, this.startingMoney);
			const playerLetter = letters[0];
			letters.shift();
			this.playerLetters.set(player, playerLetter);
			player.say("You will play as **" + playerLetter + "** for " + this.name + "!");
		}

		this.timeout = setTimeout(() => this.nextRound(), 5 * 1000);
	}

	onNextRound() {
		if (this.getRemainingPlayerCount() < 2) return this.end();
		if (!this.playerList.length) {
			this.boardRound++;
			this.playerList = this.playerOrder.slice();
			const uhtmlName = this.uhtmlBaseName + '-round';
			const html = this.getRoundHtml(this.getPlayerLetters, this.getRemainingPlayers(this.playerOrder), "Round " + this.boardRound);
			this.onUhtml(uhtmlName, html, () => {
				this.timeout = setTimeout(() => this.nextRound(), 5 * 1000);
			});
			this.sayUhtml(uhtmlName, html);
			return;
		}

		let player = this.playerList.shift();
		while (player && player.eliminated) {
			player = this.playerList.shift();
		}

		if (!player) {
			this.nextRound();
			return;
		}

		this.currentPlayer = player;
		this.onNextPlayer(player);
	}

	onEnd() {
		for (const i in this.players) {
			if (this.players[i].eliminated) continue;
			this.addBits(this.players[i], 500);
			this.winners.set(this.players[i], 1);
		}

		this.announceWinners();
	}

	getSpaceLocation(space: BoardSpace): IBoardLocation | null {
		for (let i = 0; i < boardSides.length; i++) {
			const side = boardSides[i];
			for (let i = 0; i < this.board[side].length; i++) {
				if (this.board[side][i] === space) return {side, space: i};
			}
		}

		return null;
	}

	getLocationAfterMovement(startingLocation: IBoardLocation, spacesMoved: number): IMovedBoardLocation {
		let side: BoardSide = startingLocation.side;
		let space: number = startingLocation.space;
		const forward = spacesMoved > 0;
		const passedSpaces: BoardSpace[] = [];
		let numericIndexOrder = side === 'leftColumn' || side === 'topRow';
		for (let i = 0; i < spacesMoved; i++) {
			passedSpaces.push(this.board[side][space]);

			let changeSides = false;
			if (numericIndexOrder) {
				if (forward) {
					space++;
					changeSides = space >= this.board[side].length;
				} else {
					space--;
					changeSides = space <= 0;
				}
			} else {
				if (forward) {
					space--;
					changeSides = space <= 0;
				} else {
					space++;
					changeSides = space >= this.board[side].length;
				}
			}

			if (changeSides) {
				const sideIndex = boardSides.indexOf(startingLocation.side);
				let nextSideIndex = forward ? sideIndex + 1 : sideIndex - 1;
				if (nextSideIndex === boardSides.length) {
					nextSideIndex = 0;
				} else if (nextSideIndex < 0) {
					nextSideIndex = boardSides.length - 1;
				}

				side = boardSides[nextSideIndex];
				numericIndexOrder = side === 'leftColumn' || side === 'topRow';
				if (numericIndexOrder) {
					if (forward) {
						space = 0;
					} else {
						space = this.board[side].length - 1;
					}
				} else {
					if (forward) {
						space = this.board[side].length - 1;
					} else {
						space = 0;
					}
				}
			}
		}

		return {side, space, passedSpaces};
	}

	rollDice(player: Player) {
		this.dice = [];
		for (let i = 0; i < this.numberOfDice; i++) {
			this.dice.push(this.random(6) + 1);
		}

		if (this.onPlayerRoll && this.onPlayerRoll(player) === false) return;

		let rollAmount = 0;
		for (let i = 0; i < this.dice.length; i++) {
			rollAmount += this.dice[i];
		}

		const location = this.playerLocations.get(player)!;
		const locationAfterMovement = this.getLocationAfterMovement(location, rollAmount);
		location.side = locationAfterMovement.side;
		location.space = locationAfterMovement.space;

		this.displayBoard();

		this.onSpaceLanding(player, rollAmount, locationAfterMovement);
	}

	getPlayerLetters(players?: PlayerList): string {
		return this.getPlayerAttributes(player => player.name + " (" + this.playerLetters.get(player) + ")", players).join(', ');
	}

	onPlayerRoll?(player: Player): boolean;

	abstract getSpaceHtml(side: BoardSide, space: number, playerLocations: KeyedDict<IBoard, Dict<Player[]>>): string;
	abstract onNextPlayer(player: Player): void;
	abstract onSpaceLanding(player: Player, spacesMoved: number, location: IMovedBoardLocation, teleported?: boolean): void;
}

const tests: GameFileTests<BoardGame> = {
	'it should have equal size columns and rows': {
		test(game, format) {
			assertStrictEqual(game.board.leftColumn.length, game.board.rightColumn.length);
			assertStrictEqual(game.board.topRow.length, game.board.bottomRow.length);
		},
	},
	'it should properly determine space order in getLocationAfterMovement': {
		test(game, format) {
			let locationAfterMovement = game.getLocationAfterMovement({side: 'leftColumn', space: 0}, 1);
			assertStrictEqual(locationAfterMovement.side, 'leftColumn');
			assertStrictEqual(locationAfterMovement.space, 1);

			locationAfterMovement = game.getLocationAfterMovement({side: 'leftColumn', space: 0}, 2);
			assertStrictEqual(locationAfterMovement.side, 'leftColumn');
			assertStrictEqual(locationAfterMovement.space, 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'leftColumn', space: game.board['leftColumn'].length - 1}, 1);
			assertStrictEqual(locationAfterMovement.side, 'topRow');
			assertStrictEqual(locationAfterMovement.space, 0);

			locationAfterMovement = game.getLocationAfterMovement({side: 'leftColumn', space: game.board['leftColumn'].length - 1}, 2);
			assertStrictEqual(locationAfterMovement.side, 'topRow');
			assertStrictEqual(locationAfterMovement.space, 1);

			locationAfterMovement = game.getLocationAfterMovement({side: 'topRow', space: 0}, 1);
			assertStrictEqual(locationAfterMovement.side, 'topRow');
			assertStrictEqual(locationAfterMovement.space, 1);

			locationAfterMovement = game.getLocationAfterMovement({side: 'topRow', space: 0}, 2);
			assertStrictEqual(locationAfterMovement.side, 'topRow');
			assertStrictEqual(locationAfterMovement.space, 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'topRow', space: game.board['leftColumn'].length - 1}, 1);
			assertStrictEqual(locationAfterMovement.side, 'rightColumn');
			assertStrictEqual(locationAfterMovement.space, game.board['rightColumn'].length - 1);

			locationAfterMovement = game.getLocationAfterMovement({side: 'topRow', space: game.board['leftColumn'].length - 1}, 2);
			assertStrictEqual(locationAfterMovement.side, 'rightColumn');
			assertStrictEqual(locationAfterMovement.space, game.board['rightColumn'].length - 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'rightColumn', space: game.board['rightColumn'].length - 1}, 1);
			assertStrictEqual(locationAfterMovement.side, 'rightColumn');
			assertStrictEqual(locationAfterMovement.space, game.board['rightColumn'].length - 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'rightColumn', space: game.board['rightColumn'].length - 1}, 2);
			assertStrictEqual(locationAfterMovement.side, 'rightColumn');
			assertStrictEqual(locationAfterMovement.space, game.board['rightColumn'].length - 3);

			locationAfterMovement = game.getLocationAfterMovement({side: 'rightColumn', space: 0}, 1);
			assertStrictEqual(locationAfterMovement.side, 'bottomRow');
			assertStrictEqual(locationAfterMovement.space, game.board['bottomRow'].length - 1);

			locationAfterMovement = game.getLocationAfterMovement({side: 'rightColumn', space: 0}, 2);
			assertStrictEqual(locationAfterMovement.side, 'bottomRow');
			assertStrictEqual(locationAfterMovement.space, game.board['bottomRow'].length - 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'bottomRow', space: game.board['bottomRow'].length - 1}, 1);
			assertStrictEqual(locationAfterMovement.side, 'bottomRow');
			assertStrictEqual(locationAfterMovement.space, game.board['bottomRow'].length - 2);

			locationAfterMovement = game.getLocationAfterMovement({side: 'bottomRow', space: game.board['bottomRow'].length - 1}, 2);
			assertStrictEqual(locationAfterMovement.side, 'bottomRow');
			assertStrictEqual(locationAfterMovement.space, game.board['bottomRow'].length - 3);

			locationAfterMovement = game.getLocationAfterMovement({side: 'bottomRow', space: 0}, 1);
			assertStrictEqual(locationAfterMovement.side, 'leftColumn');
			assertStrictEqual(locationAfterMovement.space, 0);

			locationAfterMovement = game.getLocationAfterMovement({side: 'bottomRow', space: 0}, 2);
			assertStrictEqual(locationAfterMovement.side, 'leftColumn');
			assertStrictEqual(locationAfterMovement.space, 1);

		},
	},
	'it should have properly initialized board spaces': {
		test(game, format) {
			let location: IMovedBoardLocation = {side: 'leftColumn', space: 0, passedSpaces: []};
			let spaceId = location.side + ": " + location.space;
			let space = game.board[location.side][location.space];
			const totalSpaces = (game.board.leftColumn.length * 2) + (game.board.topRow.length * 2);
			for (let i = 0; i < totalSpaces; i++) {
				location = game.getLocationAfterMovement(location, 1);
				spaceId = location.side + ": " + location.space;
				space = game.board[location.side][location.space];
				assert(space, spaceId);
				assert(space.name, spaceId);
				assert(space.color, spaceId);
			}
		},
	},
};

export const game: IGameTemplateFile<BoardGame> = {
	category: 'board',
	scriptedOnly: true,
	tests,
};

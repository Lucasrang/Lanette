import type { PRNGSeed } from "./lib/prng";
import type { Player } from "./room-activity";
import { Activity, PlayerTeam } from "./room-activity";
import type { Room } from "./rooms";
import type { IGameFormat, IHostDisplayUhtml, IPokemonUhtml, ITrainerUhtml, IUserHostedFormat, PlayerList } from "./types/games";
import type { IPokemon, IPokemonCopy } from "./types/pokemon-showdown";
import type { GameActionGames, GameActionLocations, IGameCustomBox, IGameHostDisplay } from "./types/storage";
import type { User } from "./users";

const teamNameLists: Dict<string[][]> = {
	'2': [["Red", "Blue"], ["Gold", "Silver"], ["Ruby", "Sapphire"], ["Diamond", "Pearl"], ["Black", "White"], ["X", "Y"], ["Sun", "Moon"],
		["Sword", "Shield"], ["Land", "Sea"], ["Time", "Space"], ["Yin", "Yang"], ["Life", "Destruction"], ["Sunne", "Moone"]],
	'3': [["Red", "Blue", "Yellow"], ["Gold", "Silver", "Crystal"], ["Ruby", "Sapphire", "Emerald"], ["Diamond", "Pearl", "Platinum"],
		["Land", "Sea", "Sky"], ["Time", "Space", "Antimatter"], ["Yin", "Yang", "Wuji"], ["Life", "Destruction", "Order"],
		["Sunne", "Moone", "Prism"]],
	'4': [["Red", "Blue", "Yellow", "Green"], ["Fall", "Winter", "Spring", "Summer"], ["Water", "Fire", "Earth", "Air"],
		["Clubs", "Spades", "Hearts", "Diamonds"]],
};

export abstract class Game extends Activity {
	readonly activityType: string = 'game';
	joinNotices = new Set<string>();
	largestTeam: PlayerTeam | null = null;
	leaveNotices = new Set<string>();
	minPlayers: number = 4;
	playerOrders: Dict<Player[]> | null = null;
	readonly round: number = 0;
	signupsStarted: boolean = false;
	signupsTime: number = 0;
	teams: Dict<PlayerTeam> | null = null;
	readonly winners = new Map<Player, number>();

	// set in initialize()
	description!: string;
	signupsUhtmlName!: string;
	joinLeaveButtonUhtmlName!: string;
	joinLeaveButtonRefreshUhtmlName!: string;
	privateJoinLeaveUhtmlName!: string;

	customBox?: IGameCustomBox;
	format?: IGameFormat | IUserHostedFormat;
	gameActionType?: GameActionGames;
	isUserHosted?: boolean;
	lastHostDisplayUhtml?: IHostDisplayUhtml;
	lastPokemonUhtml?: IPokemonUhtml;
	lastTrainerUhtml?: ITrainerUhtml;
	mascot?: IPokemonCopy;
	maxPlayers?: number;
	parentGame?: Game;
	playerCap?: number;
	playerCustomBoxes = new Map<Player, IGameCustomBox | undefined>();
	readonly points?: Map<Player, number>;
	startingPoints?: number;

	constructor(room: Room | User, pmRoom?: Room, initialSeed?: PRNGSeed) {
		super(room, pmRoom, initialSeed);
	}

	abstract getMascotIcons(): string;
	abstract getMascotAndNameHtml(additionalText?: string): string;
	abstract onInitialize(format: IGameFormat | IUserHostedFormat): void;

	getSignupsEndMessage(): string {
		return "<center>(signups have closed)</center>";
	}

	getSignupsUpdateDelay(): number {
		return Client.getSendThrottle() * 4;
	}

	rollForShinyPokemon(extraChance?: number): boolean {
		let chance = 150;
		if (extraChance) chance -= extraChance;
		return !this.random(chance);
	}

	initialize(format: IGameFormat | IUserHostedFormat): void {
		this.name = format.nameWithOptions || format.name;
		this.id = format.id;

		this.onInitialize(format);
		this.description = format.description;

		if (this.maxPlayers) this.playerCap = this.maxPlayers;
	}

	announceWinners(): void {
		if (this.parentGame) return;

		const numberOfWinners = this.winners.size;
		if (numberOfWinners) {
			if (this.isUserHosted) {
				if (Config.onUserHostedGameWin) {
					try {
						Config.onUserHostedGameWin(this.room as Room, this.format as IUserHostedFormat, this.players, this.winners,
							this.points);
					} catch (e) {
						Tools.logError(e, this.format!.name + " Config.onUserHostedGameWin");
					}
				}
			} else if (!this.isPmActivity(this.room)) {
				if (Config.onScriptedGameWin) {
					try {
						Config.onScriptedGameWin(this.room, this.format as IGameFormat, this.players, this.winners, this.points);
					} catch (e) {
						Tools.logError(e, this.format!.name + " Config.onScriptedGameWin");
					}
				}
			}

			let trainerCardsShown = false;
			if (!this.isPmActivity(this.room) && Config.showGameTrainerCards && Config.showGameTrainerCards.includes(this.room.id)) {
				const trainerCards: string[] = [];
				const noTrainerCards: string[] = [];
				this.winners.forEach((points, player) => {
					const trainerCard = Games.getTrainerCardHtml(this.room as Room, player.name, this.format);
					if (trainerCard) {
						trainerCards.push(trainerCard);
					} else {
						noTrainerCards.push("<username>" + player.name + "</username>");
					}
				});

				const trainerCardCount = trainerCards.length;
				const noTrainerCardCount = noTrainerCards.length;
				if (trainerCardCount && trainerCardCount <= 2) {
					trainerCardsShown = true;
					this.sayUhtml(this.uhtmlBaseName + "-winners", "<b>Winner" + ((trainerCardCount + noTrainerCardCount) > 1 ? "s" : "") +
						"</b>:" + (noTrainerCardCount ? "&nbsp;" + noTrainerCards.join(", ") + " and" : "") + "<br />" + "<center>" +
						trainerCards.join("") + "</center>");
				}
			}

			if (!trainerCardsShown) this.say("**Winner" + (numberOfWinners > 1 ? "s" : "") + "**: " + this.getPlayerNames(this.winners));
		} else {
			this.say("No winners this game!");
		}
	}

	setCooldownAndAutoCreate(nextGameType: 'scripted' | 'userhosted', previousGameDuration?: number): void {
		if (this.isPmActivity(this.room)) return;

		if (nextGameType === 'userhosted' && previousGameDuration && Config.gameCooldownTimers &&
			this.room.id in Config.gameCooldownTimers && Config.gameAutoCreateTimers && this.room.id in Config.gameAutoCreateTimers &&
			Games.canSkipScriptedCooldown(this.room, previousGameDuration)) {
			this.say("The cooldown will be skipped due to the duration of the previous game!");

			Games.skipScriptedCooldown(this.room);
		} else {
			Games.clearSkippedScriptedCooldown(this.room);

			if (Config.gameCooldownTimers && this.room.id in Config.gameCooldownTimers) {
				this.say("The **" + Config.gameCooldownTimers[this.room.id] + "-minute cooldown** until the next game starts now!");
				const minigameCooldownMinutes = Config.gameCooldownTimers[this.room.id] / 2;
				if (minigameCooldownMinutes >= 1) Games.setGameCooldownMessageTimer(this.room, minigameCooldownMinutes);
			}

			if (Config.gameAutoCreateTimers && this.room.id in Config.gameAutoCreateTimers) {
				let autoCreateTimer = Config.gameAutoCreateTimers[this.room.id];
				if (Config.gameCooldownTimers && this.room.id in Config.gameCooldownTimers) {
					autoCreateTimer += Config.gameCooldownTimers[this.room.id];
				}
				Games.setAutoCreateTimer(this.room, nextGameType, autoCreateTimer * 60 * 1000);
			}
		}
	}

	getDescription(): string {
		return this.description;
	}

	getSignupsPlayersHtml(): string {
		return Games.getSignupsPlayersHtml(this.customBox, this.getMascotAndNameHtml(" - signups"), this.playerCount,
			this.getPlayerUsernamesHtml());
	}

	getJoinButtonHtml(freejoin: boolean): string {
		return Games.getJoinButtonHtml(this.customBox, freejoin, this.room as Room, this.format);
	}

	sendJoinNotice(player: Player): void {
		const buttonStyle = Games.getCustomBoxButtonStyle(this.customBox, 'signups');
		let html = "You have joined the <b>" + this.name + "</b> " + this.activityType + "!&nbsp;" +
			Client.getQuietPmButton(this.room as Room, Config.commandCharacter + "leavegame " + this.room.id, "Leave", false, buttonStyle);

		if (this.gameActionType) {
			let gameActionLocation: GameActionLocations;
			const database = Storage.getDatabase(this.room as Room);
			if (database.gameScriptedOptions && player.id in database.gameScriptedOptions &&
				database.gameScriptedOptions[player.id].actionsLocations &&
				database.gameScriptedOptions[player.id].actionsLocations![this.gameActionType]) {
				gameActionLocation = database.gameScriptedOptions[player.id].actionsLocations![this.gameActionType]!;
			} else {
				gameActionLocation = 'chat';
			}

			const chat = gameActionLocation === 'chat';
			html += "<br /><br />Your actions will be sent to " + (chat ? "the chat" : "an HTML page") + "!&nbsp;" +
				Client.getQuietPmButton(this.room as Room, Config.commandCharacter + "setscriptedgameoption " + this.room.id +
				", actions," + this.gameActionType + "," + (chat ? "htmlpage" : "chat"), "Send to " + (chat ? "an HTML page" :
				"the chat"), false, buttonStyle);
		}

		player.sayPrivateUhtml(html, this.privateJoinLeaveUhtmlName);
	}

	sendFreeJoinNotice(user: User): void {
		(this.room as Room).sayPrivateUhtml(user, this.privateJoinLeaveUhtmlName, "The <b>" + this.name + "</b> " + this.activityType +
			" does not require you to join!");
	}

	sendLeaveNotice(player: Player): void {
		player.sayPrivateUhtml("You have left the " + this.name + " " + this.activityType + "." + (!this.started ? " You " +
			"will not receive any further signups messages." : ""), this.privateJoinLeaveUhtmlName);
	}

	getPlayerOrPickedCustomBox(player?: Player): IGameCustomBox | undefined {
		if (!player) return this.customBox;

		if (!this.playerCustomBoxes.has(player)) {
			const database = Storage.getDatabase(this.room as Room);
			if (database.gameScriptedBoxes && player.id in database.gameScriptedBoxes) {
				this.playerCustomBoxes.set(player, database.gameScriptedBoxes[player.id]);
			} else {
				this.playerCustomBoxes.set(player, undefined);
			}
		}

		return this.playerCustomBoxes.get(player);
	}

	getMsgRoomButton(command: string, label: string, disabled?: boolean, player?: Player): string {
		if (this.isPmActivity(this.room)) return "";

		const customBox = this.getPlayerOrPickedCustomBox(player);
		return Client.getMsgRoomButton(this.room, Config.commandCharacter + command, label, disabled,
			customBox ? Games.getCustomBoxButtonStyle(customBox, 'game', disabled) : '');
	}

	getQuietPmButton(command: string, label: string, disabled?: boolean, player?: Player): string {
		if (this.isPmActivity(this.room)) return "";

		const customBox = this.getPlayerOrPickedCustomBox(player);
		return Client.getQuietPmButton(this.room, Config.commandCharacter + command, label, disabled,
			customBox ? Games.getCustomBoxButtonStyle(customBox, 'game', disabled) : '');
	}

	getCustomBoxDiv(content: string, player?: Player): string {
		return Games.getGameCustomBoxDiv(content, this.getPlayerOrPickedCustomBox(player));
	}

	getCustomButtonsDiv(buttons: string[], player?: Player): string {
		return this.getCustomBoxDiv(buttons.join("&nbsp;|&nbsp;"), player);
	}

	sayHostDisplayUhtml(user: User, hostDisplay: IGameHostDisplay): void {
		const uhtmlName = this.uhtmlBaseName + "-" + this.round + "-hostdisplay";

		if (this.lastHostDisplayUhtml && this.lastHostDisplayUhtml.uhtmlName !== uhtmlName) {
			let lastHtml = "<div class='infobox'>";
			if (this.lastHostDisplayUhtml.trainers.length) {
				lastHtml += "<center>(trainer" + (this.lastHostDisplayUhtml.trainers.length > 1 ? "s" : "") + ": " +
					this.lastHostDisplayUhtml.trainers.map(x => x.trainer).join(", ") + ")</center>";
			}

			if (this.lastHostDisplayUhtml.pokemon.length) {
				lastHtml += "<center>";
				if (this.lastHostDisplayUhtml.pokemonType === 'gif') {
					lastHtml += "(gif" + (this.lastHostDisplayUhtml.pokemon.length > 1 ? "s" : "") + ": " +
						this.lastHostDisplayUhtml.pokemon.map(x => x.pokemon).join(", ") + ")";
				} else {
					lastHtml += "(icon" + (this.lastHostDisplayUhtml.pokemon.length > 1 ? "s" : "") + ": " +
						this.lastHostDisplayUhtml.pokemon.map(x => x.pokemon).join(", ") + ")";
				}
				lastHtml += "</center>";
			}

			lastHtml += Client.getUserAttributionHtml(this.lastHostDisplayUhtml.user);

			lastHtml += "</div>";

			this.sayUhtmlChange(this.lastHostDisplayUhtml.uhtmlName, lastHtml);
			this.lastHostDisplayUhtml = undefined;
		}

		const html = Games.getHostCustomDisplay(user.name, hostDisplay);
		if (this.lastHostDisplayUhtml && this.lastHostDisplayUhtml.html === html) return;

		this.sayUhtmlAuto(uhtmlName, html);

		this.lastHostDisplayUhtml = {
			html,
			pokemon: hostDisplay.pokemon.slice(),
			trainers: hostDisplay.trainers.slice(),
			pokemonType: hostDisplay.gifOrIcon,
			uhtmlName,
			user: user.name,
		};
	}

	sayPokemonUhtml(pokemon: IPokemon[], type: 'gif' | 'icon', uhtmlName: string, html: string, user: User): void {
		if (this.lastPokemonUhtml) {
			let lastHtml = "<div class='infobox'>";
			if (this.lastPokemonUhtml.type === 'gif') {
				lastHtml += "<center>(gif" + (this.lastPokemonUhtml.pokemon.length > 1 ? "s" : "") + ": " +
					this.lastPokemonUhtml.pokemon.join(", ") + ")</center>";
			} else {
				lastHtml += "(icon" + (this.lastPokemonUhtml.pokemon.length > 1 ? "s" : "") + ": " +
					this.lastPokemonUhtml.pokemon.join(", ") + ")";
			}

			lastHtml += Client.getUserAttributionHtml(this.lastPokemonUhtml.user);

			lastHtml += "</div>";

			this.sayUhtmlChange(this.lastPokemonUhtml.uhtmlName, lastHtml);
		}

		this.sayUhtmlAuto(uhtmlName, html);
		this.lastPokemonUhtml = {
			pokemon: pokemon.map(x => x.name),
			type,
			uhtmlName,
			user: user.name,
		};
	}

	sayTrainerUhtml(trainerList: string[], uhtmlName: string, html: string, user: User): void {
		if (this.lastTrainerUhtml) {
			let lastHtml = "<div class='infobox'><center>(trainer" + (this.lastTrainerUhtml.trainerList.length > 1 ? "s" : "") + ": " +
				this.lastTrainerUhtml.trainerList.join(", ") + ")</center>";

				lastHtml += Client.getUserAttributionHtml(this.lastTrainerUhtml.user);

			lastHtml += "</div>";

			this.sayUhtmlChange(this.lastTrainerUhtml.uhtmlName, lastHtml);
		}

		this.sayUhtmlAuto(uhtmlName, html);
		this.lastTrainerUhtml = {
			trainerList,
			uhtmlName,
			user: user.name,
		};
	}

	addPoints(player: Player, awardedPoints: number): number {
		if (!this.points) throw new Error(this.name + " called addPoints with no points Map");

		let points = this.points.get(player) || 0;
		points += awardedPoints;
		if (points) {
			this.points.set(player, points);
		} else {
			this.points.delete(player);
		}

		if (player.team) player.team.points += awardedPoints;

		return points;
	}

	shufflePlayers(players?: PlayerList): Player[] {
		return this.shuffle(this.getPlayerList(players));
	}

	getRandomPlayer(players?: PlayerList): Player {
		return this.players[this.sampleOne(Object.keys(this.getRemainingPlayers(players)))];
	}

	generateTeams(numberOfTeams: number, teamNames?: string[]): Dict<PlayerTeam> {
		const teams: Dict<PlayerTeam> = {};
		const playerList = this.shufflePlayers();
		if (!teamNames) teamNames = this.sampleOne(teamNameLists['' + numberOfTeams]);
		const teamIds: string[] = [];

		for (let i = 0; i < numberOfTeams; i++) {
			const id = Tools.toId(teamNames[i]);
			teams[id] = new PlayerTeam(teamNames[i], this);
			teamIds.push(id);
		}

		while (playerList.length) {
			for (let i = 0; i < numberOfTeams; i++) {
				const player = playerList.shift();
				if (!player) break;
				teams[teamIds[i]].addPlayer(player);
			}
		}

		return teams;
	}

	changePlayerTeam(player: Player, newTeam: PlayerTeam): void {
		let points: number | undefined;
		if (player.team) {
			const oldTeam = player.team;
			oldTeam.removePlayer(player);

			if (this.points) {
				points = this.points.get(player);
				if (points) oldTeam.points -= points;
			}
		}

		newTeam.addPlayer(player);
		if (points) newTeam.points += points;
	}

	setLargestTeam(): void {
		if (!this.teams) throw new Error("setLargestTeam() called without teams");
		const teamIds = Object.keys(this.teams);
		this.largestTeam = this.teams[teamIds[0]];

		for (let i = 1; i < teamIds.length; i++) {
			const team = this.teams[teamIds[i]];
			if (team.players.length > this.largestTeam.players.length) this.largestTeam = team;
		}
	}

	setTeamPlayerOrders(): void {
		if (!this.teams) throw new Error("setTeamPlayerOrders() called without teams");

		for (const i in this.teams) {
			this.setTeamPlayerOrder(this.teams[i]);
		}
	}

	setTeamPlayerOrder(team: PlayerTeam): void {
		if (!this.playerOrders) throw new Error("setTeamPlayerOrder() called without playerOrders");

		this.playerOrders[team.id] = [];
		for (const player of team.players) {
			if (!player.eliminated) this.playerOrders[team.id].push(player);
		}

		this.playerOrders[team.id] = this.shuffle(this.playerOrders[team.id]);
	}

	getEmptyTeams(): PlayerTeam[] {
		if (!this.teams) throw new Error("getEmptyTeams() called without teams");
		const emptyTeams: PlayerTeam[] = [];
		const teamIds = Object.keys(this.teams);
		for (const id of teamIds) {
			if (!this.getRemainingPlayerCount(this.teams[id].players)) {
				emptyTeams.push(this.teams[id]);
			}
		}

		return emptyTeams;
	}

	getFinalTeam(): PlayerTeam | undefined {
		if (!this.teams) throw new Error("getFinalTeam() called without teams");
		const remainingTeams: PlayerTeam[] = [];
		for (const team in this.teams) {
			if (this.getRemainingPlayerCount(this.teams[team].players)) {
				remainingTeams.push(this.teams[team]);
			}
		}

		return remainingTeams.length === 1 ? remainingTeams[0] : undefined;
	}

	getPlayersDisplay(): string {
		const remainingPlayers = this.getRemainingPlayerCount();
		if (!remainingPlayers) return "**Players**: none";

		if (this.teams) {
			const teamDisplays: string[] = [];
			for (const i in this.teams) {
				const team = this.teams[i];
				teamDisplays.push(team.name + (team.points ? " (" + team.points + ")" : "") + ": " +
					team.players.filter(x => !x.eliminated).map(x => x.name).join(", "));
			}

			return "**Teams** | " + teamDisplays.join(" | ");
		}

		return "**Players (" + remainingPlayers + ")**: " + (this.points ? this.getPlayerPoints() : this.getPlayerNames());
	}

	getPointsDisplay(points: number | undefined, decimalPlaces?: number): string {
		let pointsDisplay = '';
		if (points) {
			if (decimalPlaces == undefined) decimalPlaces = 3;
			pointsDisplay = points.toFixed(decimalPlaces);
			if (pointsDisplay.endsWith('.000')) pointsDisplay = pointsDisplay.substr(0, pointsDisplay.indexOf('.'));
		}

		return pointsDisplay;
	}

	getPlayerPoints(players?: PlayerList): string {
		return this.getPlayerAttributes(player => {
			const points = this.points!.get(player) || this.startingPoints;
			const pointsDisplay = this.getPointsDisplay(points);
			return player.name + (pointsDisplay ? " (" + pointsDisplay + ")" : "");
		}, players).join(', ');
	}

	getPlayerWins(players?: PlayerList): string {
		return this.getPlayerAttributes(player => {
			const wins = this.winners.get(player);
			return player.name + (wins ? " (" + wins + ")" : "");
		}, players).join(', ');
	}

	getTeamPlayers(players?: PlayerList): Dict<string[]> {
		if (!this.teams) throw new Error("getTeamPlayers() called without teams");

		players = this.getPlayerList(players);
		const teamPlayers: Dict<string[]> = {};
		for (const i in this.teams) {
			const team = this.teams[i];
			teamPlayers[team.id] = [];
			for (const player of team.players) {
				if (players.includes(player)) teamPlayers[team.id].push(player.name);
			}
		}

		return teamPlayers;
	}

	getTeamPlayerNames(players?: PlayerList): string {
		if (!this.teams) throw new Error("getTeamPlayers() called without teams");

		const teamPlayers = this.getTeamPlayers(players);
		const output: string[] = [];
		const teamKeys = Object.keys(this.teams).sort();
		for (const key of teamKeys) {
			output.push("<b>" + this.teams[key].name + "</b>: " + Tools.joinList(teamPlayers[key]));
		}
		return output.join(" | ");
	}
}

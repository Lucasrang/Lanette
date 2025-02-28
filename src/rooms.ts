import type { SearchChallenge } from "./games/templates/search-challenge";
import type { Player } from "./room-activity";
import type { ScriptedGame } from "./room-game-scripted";
import type { UserHostedGame } from "./room-game-user-hosted";
import type { Tournament } from "./room-tournament";
import type {
	GroupName, IChatLogEntry, IOutgoingMessage, IOutgoingMessageAttributes, IRoomInfoResponse, MessageListener
} from "./types/client";
import type { IFormat } from "./types/pokemon-showdown";
import type { IRepeatedMessage, IRoomMessageOptions, RoomType } from "./types/rooms";
import type { IUserHostedTournament } from "./types/tournaments";
import type { User } from "./users";

export class Room {
	approvedUserHostedTournaments: Dict<IUserHostedTournament> | null = null;
	battle: boolean | null = null;
	chatLog: IChatLogEntry[] = [];
	configBannedWords: string[] | null = null;
	configBannedWordsRegex: RegExp | null = null;
	game: ScriptedGame | null = null;
	groupchat: boolean | null = null;
	hiddenRoom: boolean | null = null;
	readonly htmlMessageListeners: Dict<MessageListener> = {};
	initialized: boolean = false;
	inviteOnlyBattle: boolean | null = null;
	leaving: boolean | null = null;
	readonly messageListeners: Dict<MessageListener> = {};
	modchat: string = 'off';
	newUserHostedTournaments: Dict<IUserHostedTournament> | null = null;
	parentRoom: Room | null = null;
	publicRoom: boolean = false;
	repeatedMessages: Dict<IRepeatedMessage> | null = null;
	searchChallenge: SearchChallenge | null = null;
	secretRoom: boolean | null = null;
	serverBannedWords: string[] | null = null;
	serverBannedWordsRegex: RegExp | null = null;
	serverHangman: boolean | null = null;
	subRoom: Room | null = null;
	timers: Dict<NodeJS.Timer> | null = null;
	tournament: Tournament | null = null;
	readonly uhtmlMessageListeners: Dict<Dict<MessageListener>> = {};
	userHostedGame: UserHostedGame | null = null;
	readonly users = new Set<User>();

	readonly id!: string;
	readonly publicId!: string;
	readonly title!: string;
	type!: RoomType;

	// set immediately in checkConfigSettings()
	unlinkTournamentReplays!: boolean;
	unlinkChallongeLinks!: boolean;

	constructor(id: string) {
		this.setId(id);
		this.setTitle(id);

		this.updateConfigSettings();

		if (id.startsWith(Tools.groupchatPrefix)) {
			const parts = id.split("-");
			const parentRoom = global.Rooms.get(parts[1]);
			if (parentRoom) {
				this.parentRoom = parentRoom;
				parentRoom.subRoom = this;
			}
		}
	}

	destroy(): void {
		if (this.parentRoom) {
			this.parentRoom.subRoom = null;
		}

		if (this.subRoom) {
			this.subRoom.parentRoom = null;
		}

		if (this.game && this.game.room === this) this.game.deallocate(true);
		if (this.searchChallenge && this.searchChallenge.room === this) this.searchChallenge.deallocate(true);
		if (this.tournament && this.tournament.room === this) this.tournament.deallocate();
		if (this.userHostedGame && this.userHostedGame.room === this) this.userHostedGame.deallocate(true);

		for (const i in this.repeatedMessages) {
			clearInterval(this.repeatedMessages[i].timer);
			// @ts-expect-error
			this.repeatedMessages[i].timer = undefined;
		}

		for (const i in this.timers) {
			clearTimeout(this.timers[i]);
			// @ts-expect-error
			this.timers[i] = undefined;
		}

		const users = Array.from(this.users.keys());
		for (const user of users) {
			this.onUserLeave(user);
			if (!user.rooms.size) Users.remove(user);
		}
		this.users.clear();

		Tools.unrefProperties(this, ["id", "title", "initialized", "leaving"]);
	}

	setId(id: string): void {
		// @ts-expect-error
		this.id = id;

		this.setPublicRoom(Client.getPublicRooms().includes(id));
		this.battle = id.startsWith(Tools.battleRoomPrefix);
		this.groupchat = id.startsWith(Tools.groupchatPrefix);

		let publicId = id;
		const extractedBattleId = Client.extractBattleId(id);
		if (extractedBattleId) {
			publicId = extractedBattleId.publicId;
		}

		// @ts-expect-error
		this.publicId = publicId;
	}

	setTitle(title: string): void {
		// @ts-expect-error
		this.title = title;
	}

	setPublicRoom(publicRoom: boolean): void {
		this.publicRoom = publicRoom;
	}

	init(type: RoomType): void {
		this.initialized = true;
		this.type = type;
	}

	updateConfigSettings(): void {
		this.configBannedWordsRegex = null;

		if (Config.roomBannedWords && this.id in Config.roomBannedWords) {
			this.configBannedWords = Config.roomBannedWords[this.id];
		} else {
			this.configBannedWords = null;
		}

		this.unlinkTournamentReplays = Config.disallowTournamentBattleLinks && Config.disallowTournamentBattleLinks.includes(this.id) ?
			true : false;
		this.unlinkChallongeLinks = Config.allowUserHostedTournaments && Config.allowUserHostedTournaments.includes(this.id) ? true : false;
	}

	addChatLog(log: string): void {
		this.chatLog.unshift({log, type: 'chat'});
		this.trimChatLog();
	}

	addHtmlChatLog(log: string): void {
		this.chatLog.unshift({log, type: 'html'});
		this.trimChatLog();
	}

	addUhtmlChatLog(uhtmlName: string, log: string): void {
		this.chatLog.unshift({log, type: 'uhtml', uhtmlName});
		this.trimChatLog();
	}

	trimChatLog(): void {
		while (this.chatLog.length > 30) {
			this.chatLog.pop();
		}
	}

	onRoomInfoResponse(response: IRoomInfoResponse): void {
		this.modchat = response.modchat === false ? 'off' : response.modchat;
		this.setTitle(response.title);

		this.hiddenRoom = response.visibility === 'hidden';
		this.publicRoom = response.visibility === 'public';
		this.secretRoom = response.visibility === 'secret';

		for (const usernameText of response.users) {
			const rank = usernameText.charAt(0);
			const {username} = Tools.parseUsernameText(usernameText.substr(1));
			const user = Users.add(username, Tools.toId(username));
			if (!this.users.has(user)) this.onUserJoin(user, rank);
		}
	}

	onUserJoin(user: User, rank: string): void {
		if (this.users.has(user)) throw new Error("User " + user.name + " already in " + this.id + " users list");

		this.users.add(user);
		user.setRoomRank(this, rank);

		if (this.game && this.game.onUserJoinRoom) this.game.onUserJoinRoom(this, user);
		if (this.searchChallenge && this.searchChallenge.onUserJoinRoom) this.searchChallenge.onUserJoinRoom(this, user);
		if (this.tournament && this.tournament.onUserJoinRoom) this.tournament.onUserJoinRoom(this, user);
		if (this.userHostedGame && this.userHostedGame.onUserJoinRoom) this.userHostedGame.onUserJoinRoom(this, user);
	}

	onUserLeave(user: User): void {
		if (!this.users.has(user)) throw new Error("User " + user.name + " not in " + this.id + " users list");

		this.users.delete(user);
		user.rooms.delete(this);
		if (user.timers && this.id in user.timers) {
			clearTimeout(user.timers[this.id]);
			// @ts-expect-error
			user.timers[this.id] = undefined;
		}

		if (this.game && this.game.onUserLeaveRoom) this.game.onUserLeaveRoom(this, user);
		if (this.searchChallenge && this.searchChallenge.onUserLeaveRoom) this.searchChallenge.onUserLeaveRoom(this, user);
		if (this.tournament && this.tournament.onUserLeaveRoom) this.tournament.onUserLeaveRoom(this, user);
		if (this.userHostedGame && this.userHostedGame.onUserLeaveRoom) this.userHostedGame.onUserLeaveRoom(this, user);
	}

	onUserRename(user: User, rank: string): void {
		if (!this.users.has(user)) {
			this.onUserJoin(user, rank);
		} else {
			user.setRoomRank(this, rank);
		}
	}

	canSendToUser(user: User): boolean {
		return user !== Users.self && user.rooms.has(this) && !user.locked;
	}

	getTargetUser(userOrPlayer: User | Player): User | undefined {
		const user = Users.get(userOrPlayer.name);
		if (!user || !this.canSendToUser(user)) return;
		return user;
	}

	getMessageWithClientPrefix(message: string): string {
		return this.id + "|" + message;
	}

	say(message: string, options?: IRoomMessageOptions): void {
		if (global.Rooms.get(this.id) !== this) return;

		if (!(options && options.dontPrepare)) message = Tools.prepareMessage(message);
		if (!(options && options.dontCheckFilter)) {
			const filter = Client.checkFilters(message, this);
			if (filter) {
				Tools.logMessage("Message not sent in " + this.title + " due to " + filter + ": " + message);
				return;
			}
		}

		const baseOutgoingMessage: Partial<IOutgoingMessage> = {
			roomid: this.id,
			message: this.getMessageWithClientPrefix(message),
			type: options && options.type ? options.type : 'chat',
		};

		const outgoingMessage = Object.assign(options || {}, baseOutgoingMessage) as IOutgoingMessage;

		if (outgoingMessage.type === 'chat' && Client.isDataRollCommand(message)) {
			outgoingMessage.slowerCommand = true;
		}

		if (!options || !options.dontMeasure) {
			outgoingMessage.measure = true;

			if (!outgoingMessage.html) outgoingMessage.text = message;
		}

		Client.send(outgoingMessage);
	}

	sayCode(code: string): void {
		if (!code) return;

		this.say("!code " + code, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'code',
			html: Client.getCodeListenerHtml(code),
		});
	}

	sayHtml(html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const options: IRoomMessageOptions = {
			html: Client.getListenerHtml(html),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'chat-html',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/addhtmlbox " + html, options);
	}

	sayUhtml(uhtmlName: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const options: IRoomMessageOptions = {
			uhtmlName,
			html: Client.getListenerUhtml(html),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'chat-uhtml',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/adduhtml " + uhtmlName + ", " + html, options);
	}

	sayUhtmlChange(uhtmlName: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const options: IRoomMessageOptions = {
			uhtmlName,
			html: Client.getListenerUhtml(html),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'chat-uhtml',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/changeuhtml " + uhtmlName + ", " + html, options);
	}

	sayAuthUhtml(uhtmlName: string, html: string): void {
		if (!Tools.checkHtml(this, html)) return;

		this.say("/addrankuhtml +, " + uhtmlName + ", " + html, {
			uhtmlName,
			html: Client.getListenerUhtml(html),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'chat-uhtml',
		});
	}

	sayAuthUhtmlChange(uhtmlName: string, html: string): void {
		if (!Tools.checkHtml(this, html)) return;

		this.say("/changerankuhtml +, " + uhtmlName + ", " + html, {
			uhtmlName,
			html: Client.getListenerUhtml(html),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'chat-uhtml',
		});
	}

	sayModUhtml(uhtmlName: string, html: string, rank: GroupName): void {
		if (!Tools.checkHtml(this, html)) return;

		this.say("/addrankuhtml " + Client.getGroupSymbols()[rank] + ", " + uhtmlName + ", " + html, {
			dontCheckFilter: true,
			dontPrepare: true,
			dontMeasure: true,
			type: 'command',
		});
	}

	sayModUhtmlChange(uhtmlName: string, html: string, rank: GroupName): void {
		if (!Tools.checkHtml(this, html)) return;

		this.say("/changerankuhtml " + Client.getGroupSymbols()[rank] + ", " + uhtmlName + ", " + html, {
			dontCheckFilter: true,
			dontPrepare: true,
			dontMeasure: true,
			type: 'command',
		});
	}

	sayPrivateHtml(userOrPlayer: User | Player, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			userid: user.id,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'private-html',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/sendprivatehtmlbox " + user.id + ", " + html, options);
	}

	sayPrivateUhtml(userOrPlayer: User | Player, uhtmlName: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			userid: user.id,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'private-html',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/sendprivateuhtml " + user.id + ", " + uhtmlName + ", " + html, options);
	}

	sayPrivateUhtmlChange(userOrPlayer: User | Player, uhtmlName: string, html: string,
		additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			userid: user.id,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'private-html',
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/changeprivateuhtml " + user.id + ", " + uhtmlName + ", " + html, options);
	}

	pmHtml(userOrPlayer: User | Player, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			html: Client.getListenerHtml(html, true),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'pm-html',
			userid: user.id,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/pminfobox " + user.id + "," + html, options);
	}

	pmUhtml(userOrPlayer: User | Player, uhtmlName: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			uhtmlName,
			html: Client.getListenerUhtml(html, true),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'pm-uhtml',
			userid: user.id,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/pmuhtml " + user.id + "," + uhtmlName + "," + html, options);
	}

	pmUhtmlChange(userOrPlayer: User | Player, uhtmlName: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			uhtmlName,
			html: Client.getListenerUhtml(html, true),
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'pm-uhtml',
			userid: user.id,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/pmuhtmlchange " + user.id + "," + uhtmlName + "," + html, options);
	}

	announce(text: string): void {
		if (!text) return;

		this.say("/announce " + text, {
			type: 'announce',
			announcement: text,
		});
	}

	warn(userOrPlayer: User | Player, reason: string): void {
		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		this.say("/warn " + user.id + ", " + reason, {
			type: 'warn',
			warnReason: reason,
		});
	}

	modnote(text: string): void {
		if (!text) return;

		this.say("/modnote " + text, {
			dontMeasure: true,
			type: 'command',
		});
	}

	notifyRank(rank: GroupName | 'all', title: string, message: string, highlightPhrase?: string): void {
		const symbol = rank === 'all' ? rank : Client.getGroupSymbols()[rank];
		this.say("/notifyrank " + symbol + "," + title + "," + message + (highlightPhrase ? ","  + highlightPhrase : ""), {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'notifyrank',
			notifyId: this.id + "-rank-" + rank,
			notifyTitle: title,
			notifyMessage: message,
		});
	}

	notifyOffRank(rank: GroupName | 'all'): void {
		const symbol = rank === 'all' ? rank : Client.getGroupSymbols()[rank];
		this.say("/notifyoffrank " + symbol, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'notifyoffrank',
			notifyId: this.id + "-rank-" + rank,
		});
	}

	notifyUser(userOrPlayer: User | Player, title: string, message?: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'notifyuser',
			userid: user.id,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/notifyuser " + user.id + "," + title + (message ? "," + message : ""), options);
	}

	notifyOffUser(userOrPlayer: User | Player, additionalAttributes?: IOutgoingMessageAttributes): void {
		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'notifyoffuser',
			userid: user.id,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/notifyoffuser " + user.id, options);
	}

	sendHtmlPage(userOrPlayer: User | Player, pageId: string, html: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'htmlpage',
			userid: user.id,
			pageId: Users.self.id + "-" + pageId,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/sendhtmlpage " + user.id + "," + pageId + "," + html, options);
	}

	changeHtmlPageSelector(userOrPlayer: User | Player, pageId: string, selector: string, html: string,
		additionalAttributes?: IOutgoingMessageAttributes): void {
		if (!Tools.checkHtml(this, html)) return;

		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'htmlpageselector',
			userid: user.id,
			pageId: Users.self.id + "-" + pageId,
			selector,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/changehtmlpageselector " + user.id + "," + pageId + "," + selector + "," + html, options);
	}

	closeHtmlPage(userOrPlayer: User | Player, pageId: string, additionalAttributes?: IOutgoingMessageAttributes): void {
		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'closehtmlpage',
			userid: user.id,
			pageId: Users.self.id + "-" + pageId,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/closehtmlpage " + user.id + "," + pageId, options);
	}

	sendHighlightPage(userOrPlayer: User | Player, pageId: string, notificationTitle?: string, highlightPhrase?: string,
		additionalAttributes?: IOutgoingMessageAttributes): void {
		const user = this.getTargetUser(userOrPlayer);
		if (!user) return;

		const options: IRoomMessageOptions = {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'highlight-htmlpage',
			userid: user.id,
			pageId: Users.self.id + "-" + pageId,
		};

		if (additionalAttributes) Object.assign(options, additionalAttributes);

		this.say("/highlighthtmlpage " + user.id + "," + pageId + "," + notificationTitle +
			(highlightPhrase ? "," + highlightPhrase : ""), options);
	}

	setModchat(level: string): void {
		if (!level) return;

		this.say("/modchat " + level, {
			filterSend: () => this.modchat !== level,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'modchat',
			modchatLevel: level,
		});
	}

	roomVoice(name: string): void {
		this.say("/roomvoice " + name, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'room-voice',
			userid: Tools.toId(name),
		});
	}

	roomDeAuth(name: string): void {
		this.say("/roomdeauth " + name, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'room-deauth',
			deauthedUserid: Tools.toId(name),
		});
	}

	createTournament(format: IFormat, type: 'elimination' | 'roundrobin', cap: number, tournamentName?: string): void {
		if (this.tournament) return;

		this.say("/tour new " + format.id + ", " + type + "," + cap + (tournamentName ? ",1," + tournamentName : ""), {
			filterSend: () => !this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-create',
			format: format.id,
		});
	}

	startTournament(): void {
		this.say("/tour start", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-start',
		});
	}

	endTournament(): void {
		this.say("/tour end", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-end',
		});
	}

	nameTournament(name: string): void {
		this.say("/tour name " + name, {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-name',
			name,
		});
	}

	setTournamentCap(playerCap: number): void {
		this.say("/tour cap " + playerCap, {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-cap',
		});
	}

	autoStartTournament(): void {
		this.say("/tour autostart on", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-autostart',
		});
	}

	setTournamentAutoDq(minutes: number): void {
		this.say("/tour autodq " + minutes, {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-autodq',
		});
	}

	runTournamentAutoDq(): void {
		this.say("/tour runautodq", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-runautodq',
		});
	}

	forcePublicTournament(): void {
		this.say("/tour forcepublic on", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-forcepublic',
		});
	}

	forceTimerTournament(): void {
		this.say("/tour forcetimer", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-forcetimer',
		});
	}

	disallowTournamentScouting(): void {
		this.say("/tour scouting disallow", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-scouting',
		});
	}

	disallowTournamentModjoin(): void {
		this.say("/tour modjoin disallow", {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-modjoin',
		});
	}

	setTournamentRules(rules: string): void {
		this.say("/tour rules " + rules, {
			filterSend: () => !!this.tournament,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-rules',
		});
	}

	disqualifyFromTournament(userOrPlayer: User | Player): void {
		this.say("/tour dq " + userOrPlayer.id, {
			filterSend: () => this.tournament && ((this.tournament.battleRoomGame &&
				userOrPlayer.id in this.tournament.battleRoomGame.players) || (userOrPlayer.id in this.tournament.players &&
				!this.tournament.players[userOrPlayer.id].eliminated)) ? true : false,
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'tournament-disqualify',
			disqualifiedUserid: userOrPlayer.id,
		});
	}

	startHangman(answer: string, hint: string, user: User): void {
		this.say("/hangman create " + answer + ", " + hint, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'hangman-start',
			userid: user.id,
		});
	}

	endHangman(): void {
		this.say("/hangman end", {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'hangman-end',
		});
	}

	getSubRoomGroupchatId(name: string): string {
		return Tools.groupchatPrefix + this.id + "-" + Tools.toId(name);
	}

	createSubRoomGroupchat(name: string): Room {
		const groupchatId = this.getSubRoomGroupchatId(name);
		const groupchat = global.Rooms.add(groupchatId);
		groupchat.parentRoom = this;

		this.subRoom = groupchat;

		this.say("/subroomgroupchat " + name, {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'join-room',
			roomid: groupchatId,
		});

		return groupchat;
	}

	leave(): void {
		if (this.leaving) return;

		this.leaving = true;
		this.say("/leave", {
			dontCheckFilter: true,
			dontPrepare: true,
			type: 'leave-room',
		});
	}

	on(message: string, listener: MessageListener): void {
		this.messageListeners[Tools.toId(Tools.prepareMessage(message))] = listener;
	}

	onHtml(html: string, listener: MessageListener, serverHtml?: boolean): void {
		const listenerHtml = serverHtml ? Tools.unescapeHTML(html) : Client.getListenerHtml(html);
		this.htmlMessageListeners[Tools.toId(listenerHtml)] = listener;
	}

	onUhtml(name: string, html: string, listener: MessageListener): void {
		const id = Tools.toId(name);
		if (!(id in this.uhtmlMessageListeners)) this.uhtmlMessageListeners[id] = {};
		this.uhtmlMessageListeners[id][Tools.toId(Client.getListenerUhtml(html))] = listener;
	}

	off(message: string): void {
		delete this.messageListeners[Tools.toId(Tools.prepareMessage(message))];
	}

	offHtml(html: string, serverHtml?: boolean): void {
		const listenerHtml = serverHtml ? Tools.unescapeHTML(html) : Client.getListenerHtml(html);
		delete this.htmlMessageListeners[Tools.toId(listenerHtml)];
	}

	offUhtml(name: string, html: string): void {
		const id = Tools.toId(name);
		if (!(id in this.uhtmlMessageListeners)) return;
		delete this.uhtmlMessageListeners[id][Tools.toId(Client.getListenerUhtml(html))];
	}
}

export class Rooms {
	createListeners: Dict<(room: Room) => void> = {};
	private rooms: Dict<Room> = {};

	private pruneRoomsInterval: NodeJS.Timer;

	constructor() {
		this.pruneRoomsInterval = setInterval(() => this.pruneRooms(), 5 * 60 * 1000);
	}

	add(id: string): Room {
		if (!(id in this.rooms)) this.rooms[id] = new Room(id);
		return this.rooms[id];
	}

	remove(room: Room): void {
		if (!(room.id in this.rooms)) throw new Error("Room " + room.id + " not in rooms list");

		delete this.rooms[room.id];
		room.destroy();
	}

	removeAll(): void {
		for (const i in this.rooms) {
			this.remove(this.rooms[i]);
		}
	}

	get(id: string): Room | undefined {
		return this.rooms[id];
	}

	getRoomIds(): string[] {
		return Object.keys(this.rooms);
	}

	renameRoom(room: Room, newId: string, newTitle: string): Room {
		if (!(room.id in this.rooms)) throw new Error("Room " + room.id + " not in rooms list");

		delete this.rooms[room.id];
		if (newId in this.rooms) {
			if (room !== this.rooms[newId]) room.destroy();
			return this.rooms[newId];
		}

		this.rooms[newId] = room;
		room.setId(newId);
		room.setTitle(newTitle);
		return room;
	}

	search(input: string): Room | undefined {
		let id = Tools.toRoomId(input);
		if (Config.roomAliases && !(id in this.rooms) && Config.roomAliases[id]) id = Config.roomAliases[id];
		return this.get(id);
	}

	updateConfigSettings(): void {
		for (const i in this.rooms) {
			this.rooms[i].updateConfigSettings();
		}
	}

	updatePublicRooms(): void {
		const publicRooms = Client.getPublicRooms();
		for (const i in this.rooms) {
			this.rooms[i].setPublicRoom(publicRooms.includes(this.rooms[i].id));
		}
	}

	pruneRooms(): void {
		const roomKeys = Object.keys(this.rooms);
		for (const key of roomKeys) {
			if (!this.rooms[key].initialized && !this.rooms[key].parentRoom && !this.rooms[key].game && !this.rooms[key].tournament) {
				this.remove(this.rooms[key]);
			}
		}
	}
}

export const instantiate = (): void => {
	global.Rooms = new Rooms();
};
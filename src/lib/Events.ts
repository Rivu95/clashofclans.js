import { EventEmitter } from 'events';
import { Store } from './Store';
import { Throttler } from '../utils/Throttler';
import { handleClanUpdate, handlePlayerUpdate, handleWarUpdate } from '../utils/updateHandler';
import { validateTag, fetchURL } from '../utils/utils';
import { AsyncQueue } from '../utils/AsyncQueue';

export class Events extends EventEmitter {

	public clans: Store = new Store();
	public players: Store = new Store();
	public wars: Store = new Store();

	public rateLimit: number;
	public refreshRate: number;

	private tokens: string[];

	private baseUrl: string;
	private timeout: number;

	private throttler: Throttler;
	private activeToken = 0;
	private queue: AsyncQueue = new AsyncQueue();

	private isInMaintenance = Boolean(false);
	private initialized = Boolean(false);

	private loopBreak = {
		player: Boolean(false),
		clan: Boolean(false),
		war: Boolean(false)
	};

	public constructor(options: EventsOption) {
		super();

		this.baseUrl = options.baseUrl || 'https://api.clashofclans.com/v1';
		this.timeout = options.timeout || 0;
		this.tokens = options.tokens;
		this.rateLimit = options.rateLimit || 10;
		this.refreshRate = options.refreshRate || 2 * 60 * 1000;
		this.throttler = new Throttler(this.rateLimit * this.tokens.length);
	}

	public addPlayers(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && !this.players.has(tag)) this.players.set(tag, {});
		});
	}

	public removePlayers(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && this.players.has(tag)) this.players.delete(tag);
		});
	}

	public clearPlayers() {
		this.loopBreak.player = true;
		this.players.clear();
	}

	public addClans(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && !this.clans.has(tag)) this.clans.set(tag, {});
		});
	}

	public removeClans(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && this.clans.has(tag)) this.clans.delete(tag);
		});
	}

	public clearClans() {
		this.loopBreak.clan = true;
		this.clans.clear();
	}

	public addWars(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && !this.wars.has(tag)) this.wars.set(tag, {});
		});
	}

	public removeWars(tags: string | string[]) {
		const list = Array.isArray(tags) ? tags : [tags];
		list.forEach(msg => {
			const tag = validateTag(msg);
			if (tag && this.wars.has(tag)) this.wars.delete(tag);
		});
	}

	public clearWars() {
		this.loopBreak.war = true;
		this.wars.clear();
	}

	public init() {
		if (this.initialized) return;
		this.initialized = Boolean(true);
		return Promise.allSettled([
			this.initWarEvents(),
			this.initClanEvents(),
			this.checkMaintenace(),
			this.initPlayerEvents()
		]);
	}

	/* ----------------------------------------------------------------------------- */
	/* ------------------------------ PRIVATE METHODS ------------------------------ */
	/* ----------------------------------------------------------------------------- */

	private async initClanEvents() {
		if (this.isInMaintenance) return;
		const startTime = Date.now();
		for (const tag of this.clans.keys()) {
			if (this.loopBreak.clan) break;
			const data = await this.fetch(`/clans/${encodeURIComponent(tag)}`);
			handleClanUpdate(this, data);
		}
		if (this.loopBreak.clan) {
			this.clans.clear();
			this.loopBreak.clan = false;
		}
		const timeTaken = Date.now() - startTime;
		const waitFor = (timeTaken >= this.refreshRate ? 0 : this.refreshRate - timeTaken);
		setTimeout(this.initClanEvents.bind(this), waitFor);
	}

	private async initPlayerEvents() {
		if (this.isInMaintenance) return;
		const startTime = Date.now();
		for (const tag of this.players.keys()) {
			if (this.loopBreak.player) break;
			const data = await this.fetch(`/players/${encodeURIComponent(tag)}`);
			handlePlayerUpdate(this, data);
		}
		if (this.loopBreak.player) {
			this.players.clear();
			this.loopBreak.player = false;
		}
		const timeTaken = Date.now() - startTime;
		const waitFor = (timeTaken >= this.refreshRate ? 0 : this.refreshRate - timeTaken);
		setTimeout(this.initPlayerEvents.bind(this), waitFor);
	}

	private async initWarEvents() {
		if (this.isInMaintenance) return;
		const startTime = Date.now();
		for (const tag of this.wars.keys()) {
			if (this.loopBreak.war) break;
			const data = await this.fetch(`/clans/${encodeURIComponent(tag)}/currentwar`);
			handleWarUpdate(this, tag, data);
		}
		if (this.loopBreak.war) {
			this.wars.clear();
			this.loopBreak.war = false;
		}
		const timeTaken = Date.now() - startTime;
		const waitFor = (timeTaken >= this.refreshRate ? 0 : this.refreshRate - timeTaken);
		setTimeout(this.initWarEvents.bind(this), waitFor);
	}

	private async checkMaintenace() {
		const data = await this.fetch(`/clans?limit=1&minMembers=${Math.floor(Math.random() * 40) + 10}`);
		if (data.status === 503 && !this.isInMaintenance) {
			this.isInMaintenance = Boolean(true);
			this.emit('maintenanceStart');
		} else if (data.status === 200 && this.isInMaintenance) {
			this.isInMaintenance = Boolean(false);
			this.emit('maintenanceEnd');
		}
		setTimeout(this.checkMaintenace.bind(this), 0.5 * 60 * 1000);
	}

	private get token() {
		const token = this.tokens[this.activeToken];
		this.activeToken = (this.activeToken + 1) >= this.tokens.length ? 0 : (this.activeToken + 1);
		return token;
	}

	private async fetch(path: string) {
		await this.queue.wait();
		try {
			return await fetchURL(`${this.baseUrl}${path}`, this.token, this.timeout);
		} finally {
			await this.throttler.throttle();
			this.queue.shift();
		}
	}

}

interface EventsOption {
	tokens: string[];
	baseUrl?: string;
	timeout?: number;
	rateLimit?: number;
	refreshRate?: number;
}

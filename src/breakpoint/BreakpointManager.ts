import { DebugProtocol } from 'vscode-debugprotocol';
import { DebugInterface } from "../debugProcess/DebugInterface";
import { window } from 'vscode';
import Q from 'q';
import { CobolBreakpoint } from '../debugProcess/CobolBreakpoint';
import { SourceUtils } from './SourceUtils';


/**
 * Class to manage source breakpoints
 */
export class BreakpointManager {

	private debugRuntime: DebugInterface;
	private externalDebuggerBreaks: Map<string, DebugProtocol.Breakpoint[]> = new Map<string, DebugProtocol.Breakpoint[]>();

	constructor(debugRuntime: DebugInterface) {
		this.debugRuntime = debugRuntime;
	}

	/**
	 * Sets breakpoints on external COBOL debug process
	 *
	 * @param source source related to breakpoints
	 * @param sourceBreaks breakpoints to be set
	 */
	public setBreakpoints(source: DebugProtocol.Source, sourceBreaks: DebugProtocol.SourceBreakpoint[]): Promise<DebugProtocol.Breakpoint[]> {
		return new Promise((resolve, reject) => {
			SourceUtils.normalize(source);
			const breaks = this.convertSourceBreakToBreak(source, sourceBreaks);
			const newBreaks = breaks.filter(b => !this.isKnownBreakpoint(this.getBreaksOnMap(source), b));
			const oldBreaks = this.getBreaksOnMap(source).filter(b => !this.isKnownBreakpoint(breaks, b));
			this.handleBreaks(newBreaks, this.setBreakOnDebugger).then(() => {
				this.handleBreaks(oldBreaks, this.removeBreakOnDebugger).then(() => {
					return resolve(this.getBreaksOnMap(source));
				}).catch((error) => {
					reject(error);
				})
			}).catch((error) => {
				reject(error);
			});
		});
	}

	/**
	 * Returns all of the breakpoints on map, which represents the breakpoints on external debugger
	 *
	 * @param source source object to filter breakpoints related to a specific file
	 */
	private getBreaksOnMap(source: DebugProtocol.Source): DebugProtocol.Breakpoint[] {
		return this.getBreaksOnMapFromString(source.name!);
	}

	/**
	 * Returns all of the breakpoints on map, which represents the breakpoints on external debugger
	 *
	 * @param source source name to filter breakpoints related to a specific file
	 */
	public getBreaksOnMapFromString(source: string): DebugProtocol.Breakpoint[] {
		let breaks = this.externalDebuggerBreaks.get(source);
		if (!breaks) {
			breaks = [];
			this.externalDebuggerBreaks.set(source, breaks);
		}
		return breaks;
	}

	/**
	 * Converts a list of SourceBreakpoit into a list of Breakpoint, which are both interfaces of VSCode API
	 *
	 * @param source source object
	 * @param sourceBreaks source breakpoints
	 */
	private convertSourceBreakToBreak(source: DebugProtocol.Source, sourceBreaks: DebugProtocol.SourceBreakpoint[]): DebugProtocol.Breakpoint[] {
		return sourceBreaks.map<DebugProtocol.Breakpoint>(b => {
			return {
				line: b.line,
				column: b.column,
				source: source,
				verified: false,
			}
		});
	}

	/**
	 * Checks if the specified breakpoint is exists on the list
	 *
	 * @param breaks all breakpoints
	 * @param target breakpoint to check if exists on the specified list
	 */
	private isKnownBreakpoint(breaks: DebugProtocol.Breakpoint[], target: DebugProtocol.Breakpoint): boolean {
		return breaks.some(b => SourceUtils.areSourcesEqual(target.source, b.source) && target.line == b.line);
	}

	/**
	 * Handles the specified array of breakpoints running breakHandler callback for every breakpoint.
	 *
	 * @param breaks breakpoints to be handler
	 * @param breakHandler handler of breakpoints
	 */
	private handleBreaks(breaks: DebugProtocol.Breakpoint[], breakHandler: (self: BreakpointManager, b: DebugProtocol.Breakpoint) => Promise<void>): Promise<void> {
		return new Promise((resolve, reject) => {
			const breaksPromises = breaks.map<Promise<void>>(b => breakHandler(this, b));
			Q.allSettled(breaksPromises).then(() => {
				return resolve();
			}).catch(() => {
				return reject();
			})
		});
	}

	/**
	 * Sets the specified breakpoint on external debugger.
	 *
	 * @param self instance of BreakpointManager where breakpoint will be removed
	 * @param br breakpoint to be removed on external debugger
	 */
	private setBreakOnDebugger(self: BreakpointManager, br: DebugProtocol.Breakpoint): Promise<void> {
		return new Promise((resolve, reject) => {
			const cobolBreak = self.createCobolBreakpoint(br);
			if (!cobolBreak) {
				return reject();
			}
			self.debugRuntime.addBreakpoint(cobolBreak).then((result) => {
				if (result) {
					br.verified = true;
				} else {
					window.showWarningMessage(`Impossible to set breakpoint on line ${cobolBreak.line}, file ${cobolBreak.source}`);
				}
				self.setBreakOnMap(self, br);
				return resolve();
			}).catch((error) => {
				console.log(error);
				return reject(error);
			});
		});
	}

	/**
	 * Sets the specified breakpoint on instance Map
	 *
	 * @param self instance of BreakpointManager where breakpoint will be set
	 * @param br breakpoint to be set on instance Map
	 */
	private setBreakOnMap(self: BreakpointManager, br: DebugProtocol.Breakpoint): void {
		self.getBreaksOnMap(br.source!).push(br);
	}

	/**
	 * Removes the specified breakpoint on external debugger.
	 *
	 * @param self instance of BreakpointManager where breakpoint will be removed
	 * @param br breakpoint to be removed on external debugger
	 */
	private removeBreakOnDebugger(self: BreakpointManager, br: DebugProtocol.Breakpoint): Promise<void> {
		return new Promise((resolve, reject) => {
			const cobolBreak = self.createCobolBreakpoint(br);
			if (!cobolBreak) {
				return reject();
			}
			self.debugRuntime.removeBreakpoint(cobolBreak).then(() => {
				self.removeBreakOnMap(self, br);
				return resolve();
			}).catch((error) => {
				console.log(error);
				return reject(error);
			});
		});
	}

	/**
	 * Removes the specified breakpoint on instance Map
	 *
	 * @param self instance of BreakpointManager where breakpoint will be removed
	 * @param br breakpoint to be removed on instance Map
	 */
	private removeBreakOnMap(self: BreakpointManager, br: DebugProtocol.Breakpoint): void {
		const breaksOnDebugger = self.getBreaksOnMap(br.source!);
		breaksOnDebugger.splice(breaksOnDebugger.indexOf(br), 1);
	}

	/**
	 * Creates an instance of CobolBreakpoint from an instance of Breakpoint of VSCode API
	 *
	 * @param br instance of breakpoint of VSCode API to be converted do CobolBreakpoint
	 */
	private createCobolBreakpoint(br: DebugProtocol.Breakpoint): CobolBreakpoint | undefined {
		if (!br.line || !br.source || !br.source.name) {
			return undefined;
		}
		return {
			line: br.line,
			source: br.source.name
		};
	}

}

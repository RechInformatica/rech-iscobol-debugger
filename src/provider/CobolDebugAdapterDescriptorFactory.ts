import { DebugAdapterDescriptorFactory, DebugSession, DebugAdapterExecutable, ProviderResult, DebugAdapterDescriptor, DebugAdapterServer } from "vscode";
import { CobolDebugSession } from "../CobolDebug";
import { Server, createServer, AddressInfo } from "net";
import { CobolStack } from "../CobolStack";

export class CobolDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {

	/** Instance representing the stack of current COBOL program */
	private cobolStack: CobolStack;

	private server?: Server;

	constructor(cobolStack: CobolStack) {
		this.cobolStack = cobolStack;
	}

	createDebugAdapterDescriptor(_session: DebugSession, _executable: DebugAdapterExecutable | undefined): ProviderResult<DebugAdapterDescriptor> {

		if (!this.server) {
			// start listening on a random port
			this.server = createServer(socket => {
				const session = new CobolDebugSession(this.cobolStack);
				session.setRunAsServer(true);
				session.start(<NodeJS.ReadableStream>socket, socket);
			}).listen(0);
		}

		// make VS Code connect to debug server
		return new DebugAdapterServer((<AddressInfo>this.server.address()).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}

import * as vscode from "vscode";
import { exec } from "child_process";
import { ExpandedDocument, ExpandedDocumentIdentifier, ExtensionSettings } from "./types";

const settingsKey = "rustMacroExpand";
const showWarnings = "Show Warnings";

/**
 * Macro text provider
 */
export class MacroTextProvider implements vscode.TextDocumentContentProvider {
  private _documents: ExpandedDocument[] = [];
  private _settings: ExtensionSettings;

  // emitter and its event
  onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this._settings = vscode.workspace.getConfiguration(settingsKey) as unknown as ExtensionSettings;

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(settingsKey)) {
        this._settings = vscode.workspace.getConfiguration(
          settingsKey
        ) as unknown as ExtensionSettings;
      }
    });

    vscode.workspace.onDidSaveTextDocument((event) => {
      if (this._settings.expandOnSave) {
        this.documentSaved(event.uri);
      }
    });
  }

  /**
   * Provides text document content
   * @param uri of the file to expand
   * @returns  expanded macro text
   */
  async provideTextDocumentContent(uri: vscode.Uri) {
    const doc = this._documents.find((x) => x.fileUri.path === uri.path);
    if (doc) {
      try {
        let text = await this.execute(
          doc,
          this._settings.displayWarnings,
          this._settings.notifyWarnings
        );
        let header = `// 🦀 Generated by Rust Macro Expand 🦀\r\n`;
        if (this._settings.displayTimestamp) {
          header += `// 🦀 Timestamp: ${new Date().toLocaleString()}  🦀\r\n`;
        }

        if (this._settings.displayCargoCommand) {
          header += `// 🦀 Cargo expand command: ${doc.cargoCommand}  🦀\r\n`;
        }

        if (this._settings.displayCargoCommandPath) {
          header += `// 🦀 Cargo expand command was executed in: ${doc.cargoPath}  🦀\r\n`;
        }

        text = header + "\r\n" + text;
        return text;
      } catch (error) {
        return `/*\r\n🦀 Executing command failed! 🦀 \r\n*/\r\n ${error}`;
      }
    } else {
      return `🦀 Could not display text for the uri: ${uri.path} 🦀`;
    }
  }

  async expand(expanded: ExpandedDocument | ExpandedDocumentIdentifier) {
    let doc = this._documents.find((x) => x.fileUri.path === expanded.fileUri.path);
    if (expanded instanceof ExpandedDocument && !doc) {
      await this.openDoc(expanded as ExpandedDocument);
    } else {
      await this.openDoc(doc as ExpandedDocument);
      this.onDidChangeEmitter.fire(expanded.fileUri);
    }
  }

  documentClosed(expanded: ExpandedDocument) {
    this._documents.splice(this._documents.indexOf(expanded), 1);
  }

  private documentSaved(uri: vscode.Uri) {
    let doc = this._documents.find((x) => uri.fsPath.includes(x.fileName));
    if (doc) {
      this.onDidChangeEmitter.fire(doc.fileUri);
    }

    for (const globalDoc of this._documents.filter((x) => x.isGlobal)) {
      this.onDidChangeEmitter.fire(globalDoc.fileUri);
    }
  }

  private async openDoc(expanded: ExpandedDocument) {
    if (!this._documents.find((x) => x.fileUri.path === expanded.fileUri.path)) {
      this._documents.push(expanded);
    }

    let doc = await vscode.workspace.openTextDocument(expanded.fileUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private execute(doc: ExpandedDocument, includeError: boolean, notifyWarnings: boolean) {
    const self = this;
    return new Promise<string>(function (resolve, reject) {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
          title: "🦀 Expanding macros 🦀",
        },
        async (progress) => {
          try {
            const result = await self.executeCommand(doc, includeError, notifyWarnings);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  private async executeCommand(doc: ExpandedDocument, includeError: boolean, notifyWarnings: boolean){
    return new Promise<string>((resolve, reject) =>{
      exec(
        doc.cargoCommand,
        {
          cwd: doc.cargoPath,
        },
        function (error, standardOutput, standardError) {
          if (error) {
            reject(error);

            return;
          }

          if (includeError && standardError) {
            standardOutput =
              `\r\n// 🦀 Warnings!!! 🦀 \r\n/*` +
              standardError +
              `*/\r\n\r\n// 🦀 Expanded code!!! 🦀 \r\n` +
              standardOutput;
          }

          if (notifyWarnings && standardError) {
            vscode.window
              .showInformationMessage("🦀 Expand had warnings!!! 🦀", showWarnings)
              .then(async (infoResponse) => {
                if (infoResponse && infoResponse === showWarnings) {
                  let doc = await vscode.workspace.openTextDocument({ content: standardError });
                  await vscode.window.showTextDocument(doc, { preview: false });
                }
              });
          }

          resolve(standardOutput);
        }
      );
    });
  }
}

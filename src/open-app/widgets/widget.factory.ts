import { Injectable } from "@nestjs/common"
import { Widget } from "./widget.interface"
import { LoginFromExternalWidget } from "./implementations/login-from-external.widget"

@Injectable()
export class WidgetFactory {
    private widgetMap: Map<string, { new (...args: any[]): Widget }> = new Map()

    constructor(private readonly loginFromExternalWidget: LoginFromExternalWidget) {
        // Register all available widgets
        this.registerWidgets()
    }

    private registerWidgets(): void {
        this.widgetMap.set("login_from_external", LoginFromExternalWidget)
    }

    /**
     * Factory method that returns a widget instance based on the provided tag
     * @param tag The widget tag (e.g., 'login_from_external')
     * @returns An instance of the requested widget or null if not found
     */
    getWidget(tag: string): Widget | null {
        // Look up the widget class from the map
        const WidgetClass = this.widgetMap.get(tag)

        if (!WidgetClass) {
            return null
        }

        // For existing instances that were injected
        if (tag === "login_from_external") {
            return this.loginFromExternalWidget
        }

        // For any new widget that wasn't explicitly injected
        // Create and return a new instance of the widget
        return new WidgetClass()
    }
}

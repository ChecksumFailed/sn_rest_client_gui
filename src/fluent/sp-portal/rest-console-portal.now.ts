import '@servicenow/sdk/global'
import { ServicePortal, SPTheme } from '@servicenow/sdk/core'
import { restExplorerPage } from '../sp-page/rest-explorer-page.now'

/**
 * A dedicated, chromeless portal for the Outbound REST Console so it launches as a bare
 * tool rather than inside the full Service Portal experience. Portal chrome (the top nav
 * bar) requires theme.header + portal.mainMenu; this theme has no header/footer and the
 * portal has no mainMenu, so neither renders. The tool page stays reachable on other
 * portals too (?id=rest_explorer) -- this just gives it a clean launch target.
 */
export const restConsoleTheme = SPTheme({
    $id: Now.ID['rest-console-theme'],
    name: 'Outbound REST Console (chromeless)',
})

export const restConsolePortal = ServicePortal({
    $id: Now.ID['rest-console-portal'],
    title: 'Outbound REST Console',
    urlSuffix: 'rest_console',
    theme: restConsoleTheme,
    homePage: restExplorerPage,
    hidePortalName: true,
})

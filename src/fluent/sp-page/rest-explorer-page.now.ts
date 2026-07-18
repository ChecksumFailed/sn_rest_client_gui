import '@servicenow/sdk/global'
import { SPPage } from '@servicenow/sdk/core'
import { restExplorerWidget } from '../sp-widget/rest_explorer/widget.now'

/**
 * Service Portal page hosting the Outbound REST Console widget. Reachable on any portal at
 * `?id=rest_explorer`. Access to the tool itself is enforced by the widget/engine
 * role check, not the page, so the page stays open and shows the denied message.
 */
export const restExplorerPage = SPPage({
    pageId: 'rest_explorer',
    title: 'Outbound REST Console',
    shortDescription: 'Exercise REST Messages and their HTTP methods with configurable auth and MID-server routing.',
    category: 'custom',
    containers: [
        {
            $id: '7fb92882224d4e45b08ff5e2d1ce96bb',
            name: 'Outbound REST Console',
            parentClass: 'container-fluid',
            order: 1,
            rows: [
                {
                    $id: '9073dbf6847f448dae22aa128f0547e3',
                    order: 1,
                    columns: [
                        {
                            $id: 'b31af0eb00be480188d911f0054eee63',
                            order: 1,
                            instances: [
                                {
                                    $id: 'f539a56cd3084ccfa7ad1deb34c1cd58',
                                    title: 'Outbound REST Console',
                                    widget: restExplorerWidget,
                                    order: 1,
                                    roles: ['x_1676196_rest_gui.user', 'admin'],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
})

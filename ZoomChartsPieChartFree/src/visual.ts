module powerbi.extensibility.visual {
    export class Visual implements IVisual {
        protected target: HTMLElement;
        protected chart: ZoomCharts.PieChart;
        protected ZC: typeof ZoomCharts;
        public host: IVisualHost;
        protected pendingData: ZoomCharts.Configuration.PieChartDataObjectRoot = { subvalues: [] };
        protected updateTimer: number;
        protected formatString: string = "#,0.00";
        protected formatter: powerbi.extensibility.utils.formatting.IValueFormatter = null;
        protected lastChartUpdatePieId = "";
        protected selectionManager: ISelectionManager;
        protected lastCategorySet: string = null;
        protected customPropertiesFree: any = [];
        public betalimitator: any = null;
        public customizationInformer: any = null;
        public viewport: any = null;

        constructor(options: VisualConstructorOptions) {
            this.target = options.element;
            this.host = options.host;
            this.selectionManager = options.host.createSelectionManager();
            this.formatter = powerbi.extensibility.utils.formatting.valueFormatter.create({format: this.formatString});

            // workaround for the host not calling `destroy()` when the visual is reloaded:
            if ((<any>this.target).__zc_visual) {
                (<any>this.target).__zc_visual.destroy();
            }

            (<any>this.target).__zc_visual = this;

            this.chart = null;

            // this.target.innerHTML = "Loading ZoomCharts. Please wait...";

            ZoomChartsLoader.ensure((zc) => this.createChart(zc), () => {
                displayMessage(this.target, "Cannot load ZoomCharts library. This visual requires internet connectivity.", "Error", true);
            });

            this.betalimitator = new betalimitator(this.target, this);
            if(this.betalimitator.checkIfExpired()) {
                this.showExpired();
            }

            this.customizationInformer = new customiztionInformer(this.target, this, {
                url: "https://zoomcharts.com/en/microsoft-power-bi-custom-visuals/custom-visuals/drill-down-pie-donut-gauge-chart/",
                images: {
                    "600x400": "https://cdn.zoomcharts-cloud.com/assets/power-bi/PC-600x400.png",
                    "500x500": "https://cdn.zoomcharts-cloud.com/assets/power-bi/PC-500x500.png",
                    "400x600": "https://cdn.zoomcharts-cloud.com/assets/power-bi/PC-400x600.png",
                    "300x200": "https://cdn.zoomcharts-cloud.com/assets/power-bi/PC-300x200.png",
                    "200x300": "https://cdn.zoomcharts-cloud.com/assets/power-bi/PC-200x300.png"
                }
            });
            this.customizationInformer.showGetFullVersionLogo();
        }

        public showExpired(){
            displayMessage(this.target, "Trial period for this visual is expired.", "Trial expired", false);
        }

        protected createChart(zc: typeof ZoomCharts) {
            // check if the visual is destroyed before chart is created.
            if (!this.target)
                return;

            this.ZC = zc;

            let chartContainer = document.createElement("div");
            chartContainer.className = "chart-container";
            this.target.appendChild(chartContainer);

            this.chart = new zc.PieChart({
                container: chartContainer,
                data:
                [{
                    preloaded: this.pendingData,
                    sortField: "value" 
                }],
                info: {
                    contentsFunction: (data, slice) => {
                        let f = this.formatter;
                        if (!f) return "";
                        return secureString(data.name)
                        + " - " 
                        + secureString(f.format(data.value))
                        + " (" 
                        + slice.percent.toFixed(1) 
                        + "%)";
                    }
                },
                interaction: {
                    resizing: { enabled: false }
                },
                events: {
                    onClick: (e, args) => {
                        if ((e.ctrlKey || e.shiftKey) && args.clickSlice && args.clickSlice.id === null)
                            e.preventDefault();
                    },
                    onSelectionChange: (e, args) => this.updateSelection(args, 200),
                    onChartUpdate: (e, args) => {
                        if (args.origin === "user" && args.pie.id !== this.lastChartUpdatePieId) {
                            this.lastChartUpdatePieId = args.pie.id;
                            this.updateSelection(args, 500);
                        }
                    }
                },
                assetsUrlBase: ZoomChartsLoader.RootUrl + "assets/"
            });

            //this.pendingData = null;
        }

        private updateSelection(args: ZoomCharts.Configuration.PieChartChartEventArguments, delay: number) {
            if (this.updateTimer) window.clearTimeout(this.updateTimer);

            let selman = this.selectionManager;
            let selectedSlices = (args.selection || []).map(o => o.data);
            if (!selectedSlices.length && args.pie.id) {
                selectedSlices = args.pie.data.values;
            }

            window.setTimeout(() => {
                if (selectedSlices.length) {
                    let sel: visuals.ISelectionId[] = [];
                    for (let i = 0; i < selectedSlices.length; i++) {
                        sel = sel.concat(selectedSlices[i].extra);
                    }
                    
                    let cursel = selman.getSelectionIds();
                    if (!arraysEqual(cursel, sel, (a: any, b: any) => a.key === b.key)) {
                        selman.clear();
                        selman.select(sel, false);
                    } else if (isDebugVisual) {
                        console.log("Selection not being updated because getSelectionIds() matches the requested selection. It is possible that the selection is not actually being applied in some cases because of what seems to be a bug in PowerBI.");
                    }
                } else {
                    selman.clear();
                }
            }, delay);
        }

        protected stringifyCategories(dataview: DataView) {
            if (!dataview) return null;
            if (!dataview.categorical || !dataview.categorical.categories) return null;

            let categories = dataview.categorical.categories;
            let res = "";
            for (let c of categories) {
                res += "///" + secureString(c.source.queryName);
            }
            return res;
        }

        public current_scale:any=1;
        public prev_pixel_ratio:any;
        @logExceptions()
        public update(options: VisualUpdateOptions) {
            updateSize(this, options.viewport);
            if (options.type & VisualUpdateType.Data) {
                let root = Data.convert(this, this.host, this.target, options);
                let catStr = this.stringifyCategories(options.dataViews[0]);

                if (root.subvalues.length) {
                    this.formatString = options.dataViews[0].categorical.values[0].source.format;
                    this.formatter = powerbi.extensibility.utils.formatting.valueFormatter.create({format: this.formatString});
                }

                this.customPropertiesFree = options.dataViews[0].metadata.objects;

                if (this.chart) {
                    this.viewport = options.viewport;
                    updateScale(options, this.chart);

                    this.chart.replaceData(root);

                    if (this.lastCategorySet !== catStr)
                        this.chart.setPie([""], 0);

                    this.pendingData = root;
                } else {
                    this.pendingData = root;
                }
                this.lastCategorySet = catStr;
            }
            
        }

        @logExceptions()
        public destroy(): void {
            this.target = null;
            if (this.chart) {
                this.chart.remove();
                this.chart = null;
            }
        }
        @logExceptions()
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            const objectName = options.objectName;
            let objectEnumeration: VisualObjectInstance[] = [];

            switch (objectName) {
                case 'customization':
                    let val = getValue(this.customPropertiesFree, "customization", "show", null);

                    let isInfoVisible = this.customizationInformer.isDialogVisible();
                    if(val == true && !isInfoVisible && !this.customizationInformer.initialCheck) {
                        this.customizationInformer.hideDialog();
                        val = false;
                    } else if(val == true) {
                        this.customizationInformer.displayDialog();
                    } else {
                        this.customizationInformer.hideDialog();
                    }

                    objectEnumeration.push({
                        objectName: objectName,
                        properties: {
                            show: val
                        },
                        selector: null
                    });

            }
            return objectEnumeration;
            /*
            return [{
                objectName: objectName,
                properties: <any>vals,
                validValues: validValues,
                selector: null
            }];
            */
        }
    }
}

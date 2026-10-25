# Domain filter candidates

The local filter writes full hostnames to the TV's hosts file. It matches exact names only: blocking `samsungads.com` does not block `rtb-config.samsungads.com`. External blockers that read `GET /blocklist` often block subdomains too, so the list never contains a parent of a name the TV needs.

## Where the names come from

Strings found in the Q80A firmware image (T-NKM2DEUC) and the component that references each one. Whether a name is reached at run time, and what happens when it is blocked, has not been tested on a TV.

| Group | Host | Referenced by |
| --- | --- | --- |
| Advertising | `rtb-config.samsungads.com` | pisa-service, ad-web-framework, tvplus |
| Advertising | `tvp-ads-log.samsungads.com` | pisa-service, ad-web-framework, tvplus |
| Advertising | `tvp-interactive-ad.samsungads.com` | ad-web-framework, tvplus |
| Analytics and KPI | `dc.di.atlas.samsung.com`, `regi.di.atlas.samsung.com`, `regi.bigdata.samsung.com` | samsung-analytics |
| Analytics and KPI | `lcprd1.samsungcloudsolution.net` | data-service-collector |
| Diagnostic logs | `fc.samsungcloud.tv`, `www.samsungrm.net` | emergency log transmitter, HSMClient, RobustnessMonitor, targetLogClient |
| Diagnostic logs | `devicelog.samsungcloudsolution.net` | smarthub-connection-test |

| Samsung QBE services | `osb.samsungqbe.com`, `rm.samsungqbe.com`, `scs.samsungqbe.com` | found in the image; the component that uses each one is not recorded |

Staging and development names in the same binaries are left out. No traffic to the QBE names has been observed, so the group says so in the dashboard.

The **reported** group (`samsungads.com`, `config.samsungads.com`, `ads.samsung.com`, `samsungacr.com`, `log-config.samsungacr.com`, `log-ingestion.samsungacr.com`, `acr0.samsungcloudsolution.com`) comes from public reports. None of these names is in the firmware. The ACR service asks a control server for the servers it uses, so its real names are only visible in traffic: use **Observe requests** while the TV is playing.

The **probable** group holds one guess: `gpm.samsungqbe.com`, which could be where the viewing-data service learns its servers. It is neither in the firmware nor confirmed in traffic, so the dashboard labels it unverified.

## Names that cannot be blocked

The local filter refuses these and exports never include them or a parent domain of them.

| Host | Why |
| --- | --- |
| `cdn.samsungcloudsolution.com`, `cdn.samsungqbe.cn` | `network-status` fetches `/Public/network/files/check.xml` here for its online check |
| `time.samsungcloudsolution.com`, `time.samsungcloudsolution.net`, `time.samsungqbe.cn` | `time-client` calls `/openapi/timesync` here to set the clock |
| `svdca.samsungqbe.com` | Samsung’s Certificate Manager fetches the developer certificate here (see INSTALLATION.md) |

`sas.samsungcloudsolution.com` and `.net` are the software-update servers (`SWU::Core::Strategies::CServerManager`). They are not refused: blocking them stops firmware updates, which is a decision for the owner. Quick settings has a switch for the same goal that is easier to undo: Support > Software Update > Auto update.

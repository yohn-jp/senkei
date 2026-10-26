# Pinned main CI diagnosis — 2026-10-26 06:xx UTC

Latest run40275861697 actualHEAD54011ea0d04cbfbb4400daa065af0681affad3d5. Primary completed failure journeys-workbench121419068929. Journeys-ui121419068981 stillrunning at finalcheck; no terminalclaim forit. Prior run40270167730 actualHEAD4b8ca49755abf3c5124973d62d75135395afcf47 failed workbench121402994554,UI121402994569,aggregatecascade.

Decoded full joblogs obtained GitHub connector fetch_workflow_job_logs, saved `/workspace/scratch/ci-<jobid>.log`. Shell Azure blob403 was bypassed by using the configured GitHub connector (not network proxybypass). Latest workbench artifact12630906494 downloaded through connector to `/workspace/scratch/latest-workbench-artifact.zip`; extracted trace `/workspace/scratch/latest-workbench-trace.zip`, snapshot `/workspace/scratch/latest-workbench-error-context.md`. Prior UI artifact12629950930 `/workspace/scratch/old-ui-artifact.zip`, tacticaltrace/context separately extracted.

## All distinct established failures

1. Workbench old+latest samefailure:600000ms whole-test timeout then finallysetOffline(false) onclosedcontext masks originalwait. LATESTtrace proves Restore saved click rwww@610 at173724ms followedpendingformationtab click rwww@612 at173848ms. Repeated logs explicitly 'element is not visible'; finalsnapshot Library. Current54011 NextWorkspace2059 Restore saved intentionallyopensLibrary viaopenLibrary() ratherthan immediateoverwrite. Testmust follow reviewflow:Library Restorepinned→reviewactualdifferences→ReplacecurrentDraft→Ready/edit. Preserveallpinned/recovery/offlineassertions. Exclusive tests/browser/specs/next-workbench.spec.ts. No productsourcefix indicated.

2. Prior UI first-run-journey Continue testline273 suffers sameoldrestoreassumption:Restore saved thenhiddenJinreitabcick. FinalcontextLibrary. Exclusive tests/browser/specs/first-run-journey.spec.ts.

3. Prior UI diagnostic-pagination line60 .diagnostic-list.getByRole(button).last nowselects new Inspect Action source button, not Replay row. ExpectedT600 actualInspectActionsource. Productaddedintentionalsourceaction. Narrowselector tolastactualdiagnostic Replayrow, preservingtick/kind/navigationassertions. Exclusive tests/browser/specs/diagnostic-pagination.spec.ts.

4. Prior UI next-npc-preflight8cases failENOENT tests/browser/apps/web/public/wasm/senkei_wasm.wasm. --prefix tests/browser setsprocess.cwd there; specresolve('apps/...') assumesreporoot. ItsViteSSRfactoryrootprocess.cwd samebug. Bothpathsneed fileURLToPath(import.meta.url) basedreporoot (likeexistingplaywrightconfig). Exclusive tests/browser/specs/next-npc-preflight.spec.ts.

5. Prior UI tactical-context mobileSelecttimeout PROVEN read/clickrace: traceeovp@1015 readsaria-expanded=false at1122379ms; clickeovp@1017 resolvesaria-expanded=true/Collapse4entities at1122609ms. NextWorkspaceautoexpand effect(1163–1169) openedpreferredcluster afterFollowview; testconditionalclickthenCOLLAPSESit. Finalsnapshotallclusterscollapsed, noSelectactions. Repairtestawait/useautomaticallyexpandedcluster thenactualSelecttarget; preserveselectedID/tick/sourceassertions. Exclusive tests/browser/specs/tactical-context.spec.ts. No productsourcefix indicated.

6. Prior UI ux-completion6cases expectoldsavecopy Saved this Next setup, actualPinned Next setup saved. Actualsnapshotshowscorrectpinnedroster/source/revision andsavecompleted. Updateassertion toactualsuccessfulpinnedstate/newstatus, preservepin/export/restore tests. Exclusive tests/browser/specs/ux-completion.spec.ts.

Prior UI totaled17failed/41passed:1diagnostic+1restore+8NPC+1tactical+6savecopy=17. No unexplainedfailedtest remains inpriorrun. Relevant6specfiles byteidentical4b8→latest54011, but latestUI terminalresult stillpending.

No source/test edits performed. NextWorkspace/JWB/HeroAtelier remainworkerexclusive; allestablishedrepairs scoped6browsertestfiles. No gateweakening/timeoutincrease/skip required. Underlying productreviewflow,Actionsource,autoexpandedFollow andsaveddata remainintact.

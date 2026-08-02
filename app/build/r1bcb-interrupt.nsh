!macro customInstall
  ReadEnvStr $R8 "METRORA_R1BCB_CHECKPOINT"
  StrCmp $R8 "" r1bcb_done

  FileOpen $R9 "$R8.ready" w
  FileWrite $R9 "metrora-r1bcb-checkpoint"
  FileClose $R9

r1bcb_wait:
  IfFileExists "$R8.release" r1bcb_done
  Sleep 100
  Goto r1bcb_wait

r1bcb_done:
!macroend

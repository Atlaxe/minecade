' Starts the Minecade Control Panel without a console window. The desktop shortcut runs:
'   wscript.exe launch.vbs "<path to node.exe>"
Option Explicit
Dim shell, fso, dir, node, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
node = "node"
If WScript.Arguments.Count > 0 Then node = WScript.Arguments(0)
code = shell.Run("""" & node & """ --disable-warning=ExperimentalWarning """ & dir & "\panel.ts""", 0, True)
If code <> 0 Then
  MsgBox "Minecade Panel stopped with an error (exit code " & code & ")." & vbCrLf & vbCrLf & _
    "Details are in " & shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\minecade-panel\panel.log", _
    vbExclamation, "Minecade Panel"
End If

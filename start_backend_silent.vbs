Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = fso.BuildPath(currentDir, "backend")
WshShell.CurrentDirectory = backendDir
WshShell.Run "python app.py", 0, False

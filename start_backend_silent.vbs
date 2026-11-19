Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\welcome\OneDrive\Desktop\Finevers\backend"
WshShell.Run "python app.py", 0, False

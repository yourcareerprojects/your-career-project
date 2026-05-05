# Helper script to run npm commands through cmd.exe
# Usage: .\npm.ps1 install
#        .\npm.ps1 run dev
#        .\npm.ps1 --version

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)

$npmCmd = "npm"
$fullCommand = $npmCmd + " " + ($Arguments -join " ")
cmd /c $fullCommand

package shapes

import (
	"os"
	bytesconv "github.com/gin-gonic/gin/internal/bytesconv"
	_ "github.com/mattn/go-sqlite3"
	. "math"
)

// import "commented/out"

var query = `import "in/a/string"`

func Top(n int) int {
	return int(bytesconv.Size(os.Args)) + int(Max(1, 2))
}

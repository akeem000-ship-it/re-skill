//go:build !windows

package main

import "fmt"

// (not Windows: the address only; the tests drive a browser themselves)
func openWindow(url, data string) { fmt.Println("MTenn3D:", url) }

package com.example.constructs

/** The constructs a Kotlin review meets: modifiers that stack, receivers, aliases and objects without a body. */

sealed class Result<out T> {
  data class Ok<T>(val value: T) : Result<T>()

  object Pending : Result<Nothing>()
}

data class User(val id: Int, val name: String)

object Registry {
  private val entries = mutableListOf<String>()

  @JvmStatic
  fun register(name: String) {
    entries += name
  }
}

enum class Color {
  RED,
  GREEN,
}

annotation class Marker

value class Meters(val value: Double)

typealias Handler = (Int) -> Unit

internal class Hidden

private fun helper(): Int = 0

fun String.shout(): String = uppercase()

fun <T> identity(value: T): T = value

suspend fun load(url: String): String = url

interface Repo<T> {
  fun find(id: Int): T?
}
